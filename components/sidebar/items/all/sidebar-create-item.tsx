import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { PentestGPTContext } from "@/context/context"
import { createChat } from "@/db/chats"
import { createFileBasedOnExtension } from "@/db/files"
import { TablesInsert } from "@/supabase/types"
import { ContentType } from "@/types"
import { FC, useContext, useRef, useState, JSX } from "react"
import { toast } from "sonner"

interface SidebarCreateItemProps {
  isOpen: boolean
  isTyping: boolean
  onOpenChange: (isOpen: boolean) => void
  contentType: ContentType
  renderInputs: () => JSX.Element
  createState: any
}

export const SidebarCreateItem: FC<SidebarCreateItemProps> = ({
  isOpen,
  onOpenChange,
  contentType,
  renderInputs,
  createState,
  isTyping
}) => {
  const { selectedWorkspace, setChats, setFiles } =
    useContext(PentestGPTContext)

  const buttonRef = useRef<HTMLButtonElement>(null)

  const [creating, setCreating] = useState(false)

  const createFunctions = {
    chats: createChat,
    files: async (
      createState: { file: File } & TablesInsert<"files">,
      workspaceId: string
    ) => {
      if (!selectedWorkspace) return

      const { file, ...rest } = createState

      const createdFile = await createFileBasedOnExtension(
        file,
        rest,
        workspaceId
      )

      return createdFile
    },
    tools: createChat
  }

  const stateUpdateFunctions = {
    chats: setChats,
    files: setFiles,
    tools: setChats
  }

  const handleCreate = async () => {
    try {
      if (!selectedWorkspace) return
      if (isTyping) return // Prevent creation while typing

      const createFunction = createFunctions[contentType]
      const setStateFunction = stateUpdateFunctions[contentType]

      if (!createFunction || !setStateFunction) return

      setCreating(true)

      const newItem = await createFunction(createState, selectedWorkspace.id)

      setStateFunction((prevItems: any) => [...prevItems, newItem])

      onOpenChange(false)
      setCreating(false)
    } catch (error) {
      toast.error(`Error creating ${contentType.slice(0, -1)}. ${error}.`)
      setCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTyping && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      buttonRef.current?.click()
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex min-w-[300px] flex-col justify-between sm:min-w-[450px]"
        side="left"
        onKeyDown={handleKeyDown}
      >
        <div className="grow overflow-auto">
          <SheetHeader>
            <SheetTitle className="text-xl font-bold sm:text-2xl">
              Create{" "}
              {contentType.charAt(0).toUpperCase() + contentType.slice(1, -1)}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-2 space-y-2 sm:mt-4 sm:space-y-3">
            {renderInputs()}
          </div>
        </div>

        <SheetFooter className="mt-2 flex justify-between">
          <div className="flex grow justify-end space-x-1 sm:space-x-2">
            <Button
              disabled={creating}
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-xs sm:text-sm"
            >
              Cancel
            </Button>

            <Button
              disabled={creating}
              ref={buttonRef}
              onClick={handleCreate}
              className="text-xs sm:text-sm"
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
