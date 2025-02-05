import { getAIProfile } from "@/lib/server/server-chat-helpers"
import { ServerRuntime } from "next"
import { buildSystemPrompt } from "@/lib/ai/prompts"
import {
  filterEmptyAssistantMessages,
  handleAssistantMessages,
  messagesIncludeImages,
  toVercelChatMessages,
  validateMessages
} from "@/lib/build-prompt"
import { handleErrorResponse } from "@/lib/models/llm/api-error"
import llmConfig from "@/lib/models/llm/llm-config"
import { generateStandaloneQuestion } from "@/lib/models/question-generator"
import { checkRatelimitOnApi } from "@/lib/server/ratelimiter"
import { createOpenAI as createOpenRouterAI } from "@ai-sdk/openai"
import { createMistral } from "@ai-sdk/mistral"
import { createDeepSeek } from "@ai-sdk/deepseek"
import { smoothStream, streamText } from "ai"
import { getModerationResult } from "@/lib/server/moderation"
// import { createToolSchemas } from "@/lib/tools/llm/toolSchemas"
import { PluginID } from "@/types/plugins"
import { executeWebSearchTool } from "@/lib/tools/llm/web-search"
import { createStreamResponse } from "@/lib/ai-helper"

export const runtime: ServerRuntime = "edge"
export const preferredRegion = [
  "iad1",
  "arn1",
  "bom1",
  "cdg1",
  "cle1",
  "cpt1",
  "dub1",
  "fra1",
  "gru1",
  "hnd1",
  "icn1",
  "kix1",
  "lhr1",
  "pdx1",
  "sfo1",
  "sin1",
  "syd1"
]

export async function POST(request: Request) {
  const {
    messages,
    chatSettings,
    isRetrieval,
    isContinuation,
    isRagEnabled,
    selectedPlugin: initialPlugin
  } = await request.json()

  try {
    const profile = await getAIProfile()
    const config = await getProviderConfig(chatSettings, profile)

    // Early validation
    if (!config.selectedModel) {
      throw new Error("Selected model is undefined")
    }
    if (config.rateLimitCheckResult !== null) {
      return config.rateLimitCheckResult.response
    }

    // Build system prompt
    const baseSystemPrompt = config.isPentestGPTPro
      ? llmConfig.systemPrompts.pgptLarge
      : llmConfig.systemPrompts.pgptSmall
    let systemPrompt = buildSystemPrompt(
      baseSystemPrompt,
      profile.profile_context
    )

    // Process RAG
    // On normal chat, the last user message is the target standalone message
    // On continuation, the tartget is the last generated message by the system
    const targetStandAloneMessage = messages[messages.length - 2].content
    const filterTargetMessage = isContinuation
      ? messages[messages.length - 3]
      : messages[messages.length - 2]

    let ragUsed = false
    let ragId: string | null = null
    let selectedPlugin = initialPlugin
    const shouldUseRAG = !isRetrieval && isRagEnabled

    if (
      shouldUseRAG &&
      llmConfig.hackerRAG.enabled &&
      llmConfig.hackerRAG.endpoint &&
      llmConfig.hackerRAG.apiKey &&
      messages.length > 0 &&
      filterTargetMessage.role === "user" &&
      filterTargetMessage.content.length > llmConfig.hackerRAG.messageLength.min
    ) {
      const { standaloneQuestion, atomicQuestions } =
        await generateStandaloneQuestion(
          messages,
          targetStandAloneMessage,
          llmConfig.systemPrompts.pentestgptCurrentDateOnly,
          true,
          config.similarityTopK,
          llmConfig.models.pentestgpt_standalone_question_openrouter
        )

      const response = await fetch(llmConfig.hackerRAG.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${llmConfig.hackerRAG.apiKey}`
        },
        body: JSON.stringify({
          query: standaloneQuestion,
          questions: atomicQuestions,
          chunks: config.similarityTopK
        })
      })

      const data = await response.json()

      if (data && data.content) {
        ragUsed = true
        // Update system prompt with RAG content
        const ragPrompt =
          `${llmConfig.systemPrompts.RAG}\n` +
          `Context for RAG enrichment:\n` +
          `---------------------\n` +
          `${data.content}\n` +
          `---------------------\n` +
          `DON'T MENTION OR REFERENCE ANYTHING RELATED TO RAG CONTENT OR ANYTHING RELATED TO RAG. USER DOESN'T HAVE DIRECT ACCESS TO THIS CONTENT, ITS PURPOSE IS TO ENRICH YOUR OWN KNOWLEDGE. ROLE PLAY.`

        systemPrompt = buildSystemPrompt(ragPrompt, profile.profile_context)
      } else {
        selectedPlugin = PluginID.WEB_SEARCH
      }
      ragId = data?.resultId
    }

    const includeImages = messagesIncludeImages(messages)
    let selectedModel = config.selectedModel
    let shouldUncensorResponse = false

    const handleMessages = (shouldUncensor: boolean) => {
      if (includeImages) {
        selectedModel = "pixtral-large-2411"
        return filterEmptyAssistantMessages(messages)
      }

      if (shouldUncensor) {
        config.isPentestGPTPro &&
          console.log("[Premium User] Uncensored mode activated")
        return handleAssistantMessages(messages)
      }

      return filterEmptyAssistantMessages(messages)
    }

    if (
      !includeImages &&
      !isContinuation &&
      selectedPlugin !== PluginID.WEB_SEARCH
    ) {
      const { shouldUncensorResponse: moderationResult } =
        await getModerationResult(messages, llmConfig.openai.apiKey || "", 10)
      shouldUncensorResponse = moderationResult
    }

    handleMessages(shouldUncensorResponse)

    // Handle web search plugin
    if (selectedPlugin === PluginID.WEB_SEARCH) {
      return createStreamResponse(async dataStream => {
        await executeWebSearchTool({
          config: {
            chatSettings,
            messages,
            profile,
            dataStream
          }
        })
      })
    }

    const provider = createProvider(selectedModel, config)

    // Remove last message if it's a continuation to remove the continue prompt
    const cleanedMessages = isContinuation ? messages.slice(0, -1) : messages

    // Remove invalid message exchanges
    const validatedMessages = validateMessages(cleanedMessages)

    try {
      return createStreamResponse(dataStream => {
        dataStream.writeData({ ragUsed, ragId })

        // const tools = config.isPentestGPTPro
        //   ? createToolSchemas({
        //       chatSettings,
        //       messages: cleanedMessages,
        //       profile,
        //       dataStream
        //     }).getSelectedSchemas(["webSearch", "browser"])
        //   : undefined

        const result = streamText({
          model: provider(
            selectedModel || "",
            config.isPentestGPTPro ? { parallelToolCalls: false } : {}
          ),
          system: systemPrompt,
          messages: toVercelChatMessages(validatedMessages, includeImages),
          temperature: 0.5,
          maxTokens: 2048,
          abortSignal: request.signal,
          // ...(!shouldUseRAG && !shouldUncensorResponse && config.isPentestGPTPro ? { tools } : null),
          experimental_transform: smoothStream()
        })

        result.mergeIntoDataStream(dataStream)
      })
    } catch (error) {
      return handleErrorResponse(error)
    }
  } catch (error: any) {
    const errorMessage = error.message || "An unexpected error occurred"
    const errorCode = error.status || 500

    return new Response(JSON.stringify({ message: errorMessage }), {
      status: errorCode
    })
  }
}

async function getProviderConfig(chatSettings: any, profile: any) {
  const isPentestGPTPro = chatSettings.model === "mistral-large"

  const defaultModel = llmConfig.models.pentestgpt_default_openrouter
  const proModel = llmConfig.models.pentestgpt_pro_openrouter

  const providerUrl = llmConfig.openrouter.url
  const providerBaseUrl = llmConfig.openrouter.baseURL

  const providerHeaders = {
    Authorization: `Bearer ${llmConfig.openrouter.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": `https://pentestgpt.com/${chatSettings.model}`,
    "X-Title": chatSettings.model
  }

  const similarityTopK = 3
  const selectedModel = isPentestGPTPro ? proModel : defaultModel
  const rateLimitCheckResult = await checkRatelimitOnApi(
    profile.user_id,
    isPentestGPTPro ? "pentestgpt-pro" : "pentestgpt"
  )

  return {
    providerUrl,
    providerBaseUrl,
    providerHeaders,
    selectedModel,
    rateLimitCheckResult,
    similarityTopK,
    isPentestGPTPro
  }
}

function createProvider(selectedModel: string, config: any) {
  if (
    selectedModel.startsWith("mistral-") ||
    selectedModel.startsWith("pixtral") ||
    selectedModel.startsWith("codestral")
  ) {
    return createMistral()
  }
  if (selectedModel.startsWith("deepseek")) {
    return createDeepSeek()
  }
  return createOpenRouterAI({
    baseURL: config.providerBaseUrl,
    headers: config.providerHeaders
  })
}
