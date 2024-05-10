import { Tables } from "@/supabase/types"
import { FC } from "react"
import { MessageTooLong } from "./message-too-long"
import { MessagePluginFile } from "./message-plugin-file"
import { MessageMarkdown } from "./message-markdown"
import { PluginID } from "@/types/plugins"

interface MessageTypeResolverProps {
  message: Tables<"messages">
  previousMessage: Tables<"messages"> | undefined
  messageSizeLimit: number
  isLastMessage: boolean
}

export const MessageTypeResolver: FC<MessageTypeResolverProps> = ({
  previousMessage,
  message,
  messageSizeLimit,
  isLastMessage
}) => {
  const isPluginOutput =
    message.plugin !== null &&
    message.plugin !== PluginID.NONE &&
    message.plugin !== PluginID.WEB_SCRAPER &&
    message.role === "assistant"

  if (
    isPluginOutput &&
    previousMessage?.content.startsWith("/") &&
    previousMessage?.content.includes(" -output ")
  ) {
    const outputFilename = previousMessage?.content
      .split("-output ")
      .pop()
      ?.trim()
    return (
      <MessagePluginFile
        created_at={message.created_at}
        content={message.content}
        plugin={message.plugin ?? PluginID.NONE}
        autoDownloadEnabled={true}
        id={message.id}
        filename={outputFilename}
        isLastMessage={isLastMessage}
      />
    )
  }

  if (
    isPluginOutput &&
    message.content.split("/n/n")[0].includes(" -output ")
  ) {
    const outputFilename = message.content
      .split("/n/n")[0]
      .match(/-output (\S+)/)?.[1]
      ?.trim()

    return (
      <MessagePluginFile
        created_at={message.created_at}
        content={message.content}
        plugin={message.plugin ?? PluginID.NONE}
        autoDownloadEnabled={true}
        id={message.id}
        filename={outputFilename}
        isLastMessage={isLastMessage}
      />
    )
  }

  if (isPluginOutput && message.content.length > messageSizeLimit) {
    return (
      <MessagePluginFile
        created_at={message.created_at}
        content={message.content}
        plugin={message.plugin ?? PluginID.NONE}
        autoDownloadEnabled={false}
        id={message.id}
        filename={message.plugin + "-" + message.id + ".md"}
        isLastMessage={isLastMessage}
      />
    )
  }

  return <MessageMarkdown content={message.content} />
}
