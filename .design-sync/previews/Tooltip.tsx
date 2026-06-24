import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Button,
} from '@vibesboard/web'
import { Info } from 'lucide-react'

export function Open() {
  return (
    <TooltipProvider>
      <div
        style={{
          padding: 72,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" aria-label="About sources">
              <Info />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Connected to 3 knowledge sources</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
