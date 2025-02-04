import { IconLayoutSidebarRightExpand } from "@tabler/icons-react"
import { FC } from "react"
import { ContentType } from "@/types"
import { SidebarCreateButtons } from "./sidebar-create-buttons"
import { SIDEBAR_ICON_SIZE } from "./sidebar-content"
import { Button } from "../ui/button"
import { WithTooltip } from "../ui/with-tooltip"

interface SidebarHeaderProps {
  handleToggleSidebar: () => void
  contentType: ContentType
  handleSidebarVisibility: () => void
}

export const SidebarHeader: FC<SidebarHeaderProps> = ({
  handleToggleSidebar,
  contentType,
  handleSidebarVisibility
}) => {
  return (
    <div className="flex w-full items-center justify-between">
      <WithTooltip
        display={"Close sidebar"}
        trigger={
          <Button
            variant="ghost"
            className="size-10 p-0"
            onClick={handleToggleSidebar}
          >
            <IconLayoutSidebarRightExpand size={SIDEBAR_ICON_SIZE} />
          </Button>
        }
        side="right"
      />

      <SidebarCreateButtons
        contentType={contentType}
        handleSidebarVisibility={handleSidebarVisibility}
      />
    </div>
  )
}
