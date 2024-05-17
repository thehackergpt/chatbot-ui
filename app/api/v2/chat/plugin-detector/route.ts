import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { buildFinalMessages } from "@/lib/build-prompt"
import llmConfig from "@/lib/models/llm/llm-config"
import { updateOrAddSystemMessage } from "@/lib/ai-helper"
import { checkRatelimitOnApi } from "@/lib/server/ratelimiter"

class APIError extends Error {
  code: any
  constructor(message: string | undefined, code: any) {
    super(message)
    this.name = "APIError"
    this.code = code
  }
}

const availablePlugins = [
  {
    name: "cvemap",
    priority: "High",
    description:
      "CVEMAP helps explore and filter CVEs based on criteria like vendor, product, and severity.",
    usageScenarios: [
      "Identifying vulnerabilities in specific software or libraries.",
      "Filtering CVEs by severity for risk assessment.",
      "List CVEs in specific software or libraries."
    ]
  },
  {
    name: "subfinder",
    priority: "High",
    description:
      "Subfinder discovers valid subdomains for websites using passive sources. It's fast and efficient.",
    usageScenarios: [
      "Enumerating subdomains for security testing.",
      "Gathering subdomains for attack surface analysis."
    ]
  },
  {
    name: "golinkfinder",
    priority: "Medium",
    description:
      "GoLinkFinder extracts endpoints from HTML and JavaScript files, helping identify URLs within a target domain.",
    usageScenarios: [
      "Finding hidden API endpoints.",
      "Extracting URLs from web applications."
    ]
  },
  {
    name: "nuclei",
    priority: "High",
    description:
      "Nuclei scans for vulnerabilities in apps, infrastructure, and networks to identify and mitigate risks.",
    usageScenarios: [
      "Scanning web applications for known vulnerabilities.",
      "Automating vulnerability assessments."
    ]
  },
  {
    name: "katana",
    priority: "Medium",
    description:
      "Katana is a fast web crawler designed to efficiently discover endpoints in both headless and non-headless modes.",
    usageScenarios: [
      "Crawling websites to map all endpoints.",
      "Discovering hidden resources on a website."
    ]
  },
  {
    name: "httpx",
    priority: "High",
    description:
      "HTTPX probes web servers, gathering information like status codes, headers, and technologies.",
    usageScenarios: [
      "Analyzing server responses.",
      "Detecting technologies and services used on a server."
    ]
  },
  {
    name: "naabu",
    priority: "High",
    description:
      "Naabu is a port scanning tool that quickly enumerates open ports on target hosts, supporting SYN, CONNECT, and UDP scans.",
    usageScenarios: [
      "Scanning for open ports on a network.",
      "Identifying accessible services on a host."
    ]
  },
  {
    name: "dnsx",
    priority: "Low",
    description:
      "DNSX runs multiple DNS queries to discover records and perform DNS brute-forcing with user-supplied resolvers.",
    usageScenarios: [
      "Querying DNS records for a domain.",
      "Brute-forcing subdomains."
    ]
  },
  {
    name: "alterx",
    priority: "Low",
    description:
      "AlterX generates custom subdomain wordlists using DSL patterns, enriching enumeration pipelines.",
    usageScenarios: [
      "Creating wordlists for subdomain enumeration.",
      "Generating custom permutations for subdomains."
    ]
  },
  {
    name: "None",
    priority: "Highest",
    description:
      "This option is used when no specific plugin is suitable for the user's request, typically for informational queries.",
    usageScenarios: [
      "User asks for general information.",
      "User asks for specific {plugin ID} information.",
      "The request is informational and does not require direct plugin intervention.",
      "How to run a {plugin ID} locally.",
      "User requests conceptual explanations.",
      "User inquires about installation instructions.",
      "tell me about {plugin ID}",
      "how can I use this wordlist for attack",
      "what can you tell me about those domains",
      "what plugin would you recommend for subdomain discovery",
      "what tools can I use to scan domains?",
      "explain how to use {plugin ID}"
    ]
  }
]

export async function POST(request: Request) {
  const json = await request.json()
  const { payload, chatImages, selectedPlugin } = json

  const USE_PLUGIN_DETECTOR =
    process.env.USE_PLUGIN_DETECTOR?.toLowerCase() === "true"

  if (!USE_PLUGIN_DETECTOR) {
    return new Response(JSON.stringify({ plugin: "None" }), { status: 200 })
  }

  try {
    const profile = await getServerProfile()
    const openrouterApiKey = profile.openrouter_api_key || ""

    const rateLimitCheckResult = await checkRatelimitOnApi(
      profile.user_id,
      "pluginDetector"
    )

    if (rateLimitCheckResult !== null) {
      return new Response(JSON.stringify({ plugin: "None" }), { status: 200 })
    }

    const useOpenRouter = process.env.USE_OPENROUTER?.toLowerCase() === "true"
    const providerUrl = useOpenRouter
      ? llmConfig.openrouter.url
      : llmConfig.together.url
    const selectedStandaloneQuestionModel = useOpenRouter
      ? llmConfig.models.hackerGPT_standalone_question_openrouter
      : llmConfig.models.hackerGPT_standalone_question_together
    const providerHeaders = {
      Authorization: `Bearer ${useOpenRouter ? openrouterApiKey : process.env.TOGETHER_API_KEY}`,
      "Content-Type": "application/json"
    }

    const messages = await buildFinalMessages(
      payload,
      profile,
      chatImages,
      selectedPlugin
    )
    const cleanedMessages = messages as any[]

    const systemMessageContent = `${llmConfig.systemPrompts.hackerGPT}`
    updateOrAddSystemMessage(cleanedMessages, systemMessageContent)

    const lastUserMessage = cleanedMessages[cleanedMessages.length - 2].content

    if (lastUserMessage.length > llmConfig.pinecone.messageLength.max) {
      return new Response(JSON.stringify({ plugin: "None" }), { status: 200 })
    }

    const detectedPlugin = await detectPlugin(
      messages,
      lastUserMessage,
      providerUrl,
      providerHeaders,
      selectedStandaloneQuestionModel
    )

    if (
      detectedPlugin === "None" ||
      !availablePlugins.map(plugin => plugin.name).includes(detectedPlugin)
    ) {
      return new Response(JSON.stringify({ plugin: "None" }), { status: 200 })
    } else {
      return new Response(JSON.stringify({ plugin: detectedPlugin }), {
        status: 200
      })
    }
  } catch (error: any) {
    if (error instanceof APIError) {
      console.error(
        `API Error - Code: ${error.code}, Message: ${error.message}`
      )
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.code
      })
    } else {
      console.error(`Unexpected Error: ${error.message}`)
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500
      })
    }
  }
}

async function detectPlugin(
  messages: any[],
  lastUserMessage: string,
  openRouterUrl: string | URL | Request,
  openRouterHeaders: any,
  selectedStandaloneQuestionModel: string | undefined
) {
  const modelStandaloneQuestion = selectedStandaloneQuestionModel

  // Filter out empty assistant messages, exclude the first and last message, and pick the last 3 messages
  const chatHistory = messages
    .filter(msg => !(msg.role === "assistant" && msg.content === ""))
    .slice(0, -1)
    .slice(-4)
    .map(msg => {
      return {
        role: msg.role,
        content:
          msg.content.substring(0, 1000) +
          (msg.content.length > 1000 ? "..." : "")
      }
    })

  const pluginsInfo = availablePlugins
    .map(
      plugin =>
        `${plugin.name}|${plugin.priority}|${plugin.description}|${plugin.usageScenarios.join("; ")}`
    )
    .join("\n")

  const template = `      
      Based on the given follow-up question and chat history, determine if the user wants to use a plugin inside the chat environment for their task. 

      # User Input:
      - Query: """${lastUserMessage}"""

      # Available Plugins
      ID|Priority|Description|Usage Scenarios
      ${pluginsInfo}

      # Very Important Rules:
      - All plugins run in our cloud platform, so it the user is asking to run anywhere else, respond with ID = None.
      - For information requests like 'how to install a plugin', 'tell me about subfinder', 'what plugin would you recommend for subdomain discovery', or 'how can I use this wordlist for attack', respond with ID = None., as these do not require direct plugin intervention.
      - If the question starts with explain, how to, detail, tell me about, help me choose, which plugins are the best for my task, etc, use ID = None.
      - If the user is asking about a plugin, but the plugin is not available, respond with ID = None.
      - If the request requires more than one plugin to be used, respond with ID = None.
      - Always pick None if you are not sure.
  
      # Output only the following:
      \`\`\`
      <ScratchPad>{Your concise reasoning, step by step}</ScratchPad>
      <Plugin>{single plugin ID, if multiple plugins are requested, respond with None}</Plugin>     
      \`\`\`
      `

  const firstMessage = messages[0]
    ? messages[0]
    : { role: "system", content: `${llmConfig.systemPrompts.hackerGPT}` }

  try {
    const requestBody = {
      model: modelStandaloneQuestion,
      route: "fallback",
      messages: [
        { role: firstMessage.role, content: firstMessage.content },
        ...chatHistory,
        { role: "user", content: template }
      ],
      temperature: 0.1,
      max_tokens: 512
    }

    const res = await fetch(openRouterUrl, {
      method: "POST",
      headers: openRouterHeaders,
      body: JSON.stringify(requestBody)
    })

    if (!res.ok) {
      const errorBody = await res.text()
      throw new Error(
        `HTTP error! status: ${res.status}. Error Body: ${errorBody}`
      )
    }

    const data = await res.json()

    const aiResponse = data.choices?.[0]?.message?.content?.trim()
    const pluginMatch = aiResponse.match(/<plugin>(.*?)<\/plugin>/i)
    const detectedPlugin = pluginMatch ? pluginMatch[1].toLowerCase() : "None"

    console.log({
      aiResponse,
      detectedPlugin
    })

    if (!availablePlugins.map(plugin => plugin.name).includes(detectedPlugin)) {
      return "None"
    } else {
      return detectedPlugin
    }
  } catch (error) {
    return "None"
  }
}
