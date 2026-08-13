import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from '@vibesboard/web'

export function Trigger() {
  return (
    <div
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 320,
      }}
    >
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
      </Select>
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Locked to GPT-5.4" />
        </SelectTrigger>
      </Select>
    </div>
  )
}

export function OpenList() {
  return (
    <div style={{ padding: 24, maxWidth: 320 }}>
      <Select open defaultValue="gpt">
        <SelectTrigger>
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Models</SelectLabel>
            <SelectItem value="gpt">GPT-5.4</SelectItem>
            <SelectItem value="nano">GPT-5.4 nano</SelectItem>
            <SelectItem value="haiku">Claude Haiku 4.5</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
