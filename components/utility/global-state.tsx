"use client"

import { PentestGPTContext } from "@/context/context"
import { getChatFilesByChatId } from "@/db/chat-files"
import { getChatById } from "@/db/chats"
import { getMessagesByChatId } from "@/db/messages"
import { getProfileByUserId } from "@/db/profile"
import { getMessageImageFromStorage } from "@/db/storage/message-images"
import {
  getSubscriptionByTeamId,
  getSubscriptionByUserId
} from "@/db/subscriptions"
import { getTeamMembersByTeamId } from "@/db/teams"
// import { getWorkspacesByUserId } from "@/db/workspaces"
import { convertBlobToBase64 } from "@/lib/blob-to-b64"
import { supabase } from "@/lib/supabase/browser-client"
import { ProcessedTeamMember } from "@/lib/team-utils"
import { Tables } from "@/supabase/types"
import {
  ChatFile,
  ChatMessage,
  ChatSettings,
  ContentType,
  LLMID,
  MessageImage,
  SubscriptionStatus
} from "@/types"
import { User } from "@supabase/supabase-js"
import { useRouter, useSearchParams } from "next/navigation"
import { FC, useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { FragmentsProvider } from "../chat/chat-hooks/use-fragments"

const MESSAGES_PER_FETCH = 20

interface GlobalStateProps {
  children: React.ReactNode
}

export const GlobalState: FC<GlobalStateProps> = ({ children }) => {
  const router = useRouter()
  const searchParams = useSearchParams()

  // USER STORE
  const [user, setUser] = useState<User | null>(null)

  // PROFILE STORE
  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null)

  // CONTENT TYPE STORE
  const [contentType, setContentType] = useState<ContentType>("chats")

  // SUBSCRIPTION STORE
  const [subscription, setSubscription] =
    useState<Tables<"subscriptions"> | null>(null)
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatus>("free")
  const [teamMembers, setTeamMembers] = useState<ProcessedTeamMember[] | null>(
    null
  )
  const [membershipData, setMembershipData] =
    useState<ProcessedTeamMember | null>(null)
  // ITEMS STORE
  const [chats, setChats] = useState<Tables<"chats">[]>([])
  const [files, setFiles] = useState<Tables<"files">[]>([])
  // const [workspaces, setWorkspaces] = useState<Tables<"workspaces">[]>([])

  // WORKSPACE STORE
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<Tables<"workspaces"> | null>(null)

  // PASSIVE CHAT STORE
  const [userInput, setUserInput] = useState<string>("")
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [temporaryChatMessages, setTemporaryChatMessages] = useState<
    ChatMessage[]
  >([])
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
    model: "mistral-medium",
    includeProfileContext: false
  })
  const [selectedChat, setSelectedChat] = useState<Tables<"chats"> | null>(null)

  // ACTIVE CHAT STORE
  const [abortController, setAbortController] =
    useState<AbortController | null>(null)

  // ATTACHMENTS STORE
  const [chatFiles, setChatFiles] = useState<ChatFile[]>([])
  const [chatImages, setChatImages] = useState<MessageImage[]>([])
  const [newMessageFiles, setNewMessageFiles] = useState<ChatFile[]>([])
  const [newMessageImages, setNewMessageImages] = useState<MessageImage[]>([])
  const [showFilesDisplay, setShowFilesDisplay] = useState<boolean>(false)

  // RETIEVAL STORE
  const [useRetrieval, setUseRetrieval] = useState<boolean>(false)
  const [sourceCount, setSourceCount] = useState<number>(4)

  // Audio
  const [currentPlayingMessageId, setCurrentPlayingMessageId] = useState<
    string | null
  >(null)
  const [isMicSupported, setIsMicSupported] = useState(true)

  // TEMPORARY CHAT STORE
  const [isTemporaryChat, setIsTemporaryChat] = useState(false)

  // Loading Messages States
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false)

  const [userEmail, setUserEmail] = useState("")

  useEffect(() => {
    setIsTemporaryChat(searchParams.get("temporary-chat") === "true")
  }, [searchParams])

  useEffect(() => {
    fetchStartingData()
  }, [])

  const updateSubscription = useCallback(
    (newSubscription: Tables<"subscriptions"> | null) => {
      setSubscription(newSubscription)
      if (newSubscription) {
        setSubscriptionStatus(newSubscription.plan_type as SubscriptionStatus)
      } else {
        setSubscriptionStatus("free")
      }
    },
    []
  )

  const isPremiumSubscription = useMemo(
    () => subscriptionStatus !== "free",
    [subscriptionStatus]
  )

  const fetchStartingData = async () => {
    const {
      data: { user: userFromAuth }
    } = await supabase.auth.getUser()

    if (userFromAuth) {
      setUser(userFromAuth)
      setUserEmail(userFromAuth.email || "Not available")

      const profile = await getProfileByUserId(userFromAuth.id)
      if (!profile) return

      setProfile(profile)

      if (!profile.has_onboarded) {
        return router.push("/setup")
      }

      const subscription = await getSubscriptionByUserId(userFromAuth.id)
      updateSubscription(subscription)

      const members = await getTeamMembersByTeamId(
        userFromAuth.id,
        userFromAuth.email,
        subscription?.team_id
      )

      const membershipData = members?.find(
        member =>
          member.member_user_id === userFromAuth.id ||
          member.invitee_email === userFromAuth.email
      )

      if (membershipData?.invitation_status !== "rejected") {
        setTeamMembers(members)
        setMembershipData(membershipData ?? null)
      } else {
        setTeamMembers(null)
        setMembershipData(null)
      }

      if (
        (!subscription || subscription.status !== "active") &&
        members &&
        members.length > 0
      ) {
        const subscription = await getSubscriptionByTeamId(members[0].team_id)
        updateSubscription(subscription)
      }
    }
  }

  const refreshTeamMembers = async () => {
    await fetchStartingData()
  }

  const fetchMessagesAndProcess = async (
    chatId: string,
    oldestSequenceNumber?: number
  ) => {
    if (isTemporaryChat) {
      return temporaryChatMessages
    }

    const fetchedMessages = await getMessagesByChatId(
      chatId,
      MESSAGES_PER_FETCH,
      oldestSequenceNumber
    )

    const imagePromises: Promise<MessageImage>[] = fetchedMessages.flatMap(
      message =>
        message.image_paths
          ? message.image_paths.map(async imagePath => {
              const url = await getMessageImageFromStorage(imagePath)

              if (url) {
                const response = await fetch(url)
                const blob = await response.blob()
                const base64 = await convertBlobToBase64(blob)

                return {
                  messageId: message.id,
                  path: imagePath,
                  base64,
                  url,
                  file: null
                }
              }

              return {
                messageId: message.id,
                path: imagePath,
                base64: "",
                url,
                file: null
              }
            })
          : []
    )

    const images: MessageImage[] = await Promise.all(imagePromises.flat())
    setChatImages(prevImages => [...prevImages, ...images])

    return fetchedMessages.map(fetchMessage => ({
      message: fetchMessage,
      fileItems: fetchMessage.file_items,
      feedback: fetchMessage.feedback[0] ?? undefined,
      isFinal: true
    }))
  }

  const handleChatNotFound = (chatId: string, workspaceId: string) => {
    const toastKey = `chat-not-found-${chatId}`
    if (!window.sessionStorage.getItem(toastKey)) {
      toast.error("Unable to load conversation " + chatId)
      window.sessionStorage.setItem(toastKey, "true")
      setTimeout(() => window.sessionStorage.removeItem(toastKey), 2000)
    }

    router.push(`/${workspaceId}/c`)
  }

  const fetchMessages = async (chatId: string, workspaceId: string) => {
    if (isTemporaryChat) {
      return
    }

    const reformatedMessages = await fetchMessagesAndProcess(chatId)

    const chatFiles = await getChatFilesByChatId(chatId)

    if (!chatFiles) {
      // Chat not found, redirect to the workspace chat page
      handleChatNotFound(chatId, workspaceId)
      return
    }

    setChatFiles(
      chatFiles.files.map(file => ({
        id: file.id,
        name: file.name,
        type: file.type,
        file: null
      }))
    )

    setUseRetrieval(chatFiles.files.length > 0)
    setShowFilesDisplay(chatFiles.files.length > 0)
    setAllMessagesLoaded(false)
    setIsLoadingMore(false)

    setChatMessages(reformatedMessages)
  }

  const loadMoreMessages = async (chatId: string) => {
    if (
      isTemporaryChat ||
      allMessagesLoaded ||
      isLoadingMore ||
      !chatMessages.length
    )
      return

    const oldestSequenceNumber = chatMessages[0].message.sequence_number

    if (!chatId) {
      console.error("Chat ID is undefined")
      return
    }

    setIsLoadingMore(true)

    try {
      const olderMessages = await fetchMessagesAndProcess(
        chatId,
        oldestSequenceNumber
      )

      if (olderMessages.length > 0) {
        setChatMessages(prevMessages => [...olderMessages, ...prevMessages])
      }

      setAllMessagesLoaded(
        olderMessages.length < MESSAGES_PER_FETCH ||
          olderMessages[0].message.sequence_number <= 1
      )
    } catch (error) {
      console.error("Error loading more messages:", error)
    } finally {
      setTimeout(() => {
        setIsLoadingMore(false)
      }, 200)
    }
  }

  const fetchChat = async (chatId: string, workspaceId: string) => {
    if (isTemporaryChat) {
      return
    }

    try {
      const chat = await getChatById(chatId)
      if (!chat) {
        // Chat not found, redirect to the workspace chat page
        router.push(`/${workspaceId}/c`)
        return
      }

      setSelectedChat(chat)
      setChatSettings({
        model: chat.model as LLMID,
        includeProfileContext: chat.include_profile_context
      })
    } catch (error) {
      console.error("Error fetching chat:", error)
      // Handle the error, e.g., show an error message to the user
      // and redirect to the workspace chat page
      handleChatNotFound(chatId, workspaceId)
    }
  }

  return (
    <PentestGPTContext.Provider
      value={{
        // USER STORE
        user,

        // PROFILE STORE
        profile,
        setProfile,
        fetchStartingData,

        // CONTENT TYPE STORE
        contentType,
        setContentType,

        // SUBSCRIPTION STORE
        subscription,
        setSubscription,
        subscriptionStatus,
        setSubscriptionStatus,
        updateSubscription,
        isPremiumSubscription,
        teamMembers,
        refreshTeamMembers,
        membershipData,

        // ITEMS STORE
        chats,
        setChats,
        files,
        setFiles,
        // workspaces,
        // setWorkspaces,

        // WORKSPACE STORE
        selectedWorkspace,
        setSelectedWorkspace,

        // PASSIVE CHAT STORE
        userInput,
        setUserInput,
        chatMessages,
        setChatMessages,
        temporaryChatMessages,
        setTemporaryChatMessages,
        chatSettings,
        setChatSettings,
        selectedChat,
        setSelectedChat,

        // ACTIVE CHAT STORE
        abortController,
        setAbortController,

        // ATTACHMENT STORE
        chatFiles,
        setChatFiles,
        chatImages,
        setChatImages,
        newMessageFiles,
        setNewMessageFiles,
        newMessageImages,
        setNewMessageImages,
        showFilesDisplay,
        setShowFilesDisplay,

        // RETRIEVAL STORE
        useRetrieval,
        setUseRetrieval,
        sourceCount,
        setSourceCount,

        // Audio
        currentPlayingMessageId,
        setCurrentPlayingMessageId,
        isMicSupported,
        setIsMicSupported,

        // TEMPORARY CHAT STORE
        isTemporaryChat,

        // Fetch Chat and Messages
        fetchChat,
        fetchMessages,
        loadMoreMessages,

        // Loading Messages States
        isLoadingMore,
        allMessagesLoaded,

        // User Email
        userEmail,
        setUserEmail
      }}
    >
      <FragmentsProvider>{children}</FragmentsProvider>
    </PentestGPTContext.Provider>
  )
}
