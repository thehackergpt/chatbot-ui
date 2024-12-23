import { useChatHandler } from "@/components/chat/chat-hooks/use-chat-handler"
import { ContentType } from "@/types"
import { IconMessagePlus, IconRefresh } from "@tabler/icons-react"
import { FC, useContext } from "react"
import { Button } from "../ui/button"
// import { CreateFile } from "./items/files/create-file"
import { PentestGPTContext } from "@/context/context"
import { SIDEBAR_ICON_SIZE } from "./sidebar-content"

interface SidebarCreateButtonsProps {
  contentType: ContentType
  handleSidebarVisibility: () => void
}

export const SidebarCreateButtons: FC<SidebarCreateButtonsProps> = ({
  contentType,
  handleSidebarVisibility
}) => {
  const { isTemporaryChat, setTemporaryChatMessages } =
    useContext(PentestGPTContext)
  const { handleNewChat } = useChatHandler()

  // const [isCreatingFile, setIsCreatingFile] = useState(false)

  const getCreateFunction = () => {
    switch (contentType) {
      case "chats":
      case "files":
        if (isTemporaryChat) {
          return () => {
            setTemporaryChatMessages([])
            handleSidebarVisibility()
          }
        }
        return async () => {
          handleNewChat()
          handleSidebarVisibility()
        }

      // case "files":
      //   return async () => {
      //     setIsCreatingFile(true)
      //   }

      default:
        break
    }
  }

  return (
    <div className="flex">
      <Button
        variant="ghost"
        className="size-10 p-0"
        onClick={getCreateFunction()}
      >
        {isTemporaryChat && contentType === "chats" ? (
          <IconRefresh size={SIDEBAR_ICON_SIZE} />
        ) : (
          <IconMessagePlus size={SIDEBAR_ICON_SIZE} />
        )}
      </Button>

      {/* {isCreatingFile && (
        <CreateFile isOpen={isCreatingFile} onOpenChange={setIsCreatingFile} />
      )} */}
    </div>
  )
}
