# Vibesboard UI — conventions

Build screens with the real Vibesboard components (imported from the library) plus Tailwind
utility classes wired to this system's design tokens. The components are already styled — your
job is to compose them and lay out screens with the token-backed utilities below. Don't hand-roll
look-alikes or invent hex values; use a component if one exists and a token utility for the rest.

## Setup & wrapping

- **No global theme provider is required.** Tokens are CSS variables applied through `styles.css`
  (loaded for you). Dark mode = add the `dark` class to a root element.
- **`Tooltip` is the one wrapper exception** — wrap tooltip usage in `<TooltipProvider>`.
- Radix-based compound components manage their own context — just compose their parts and control
  them with `open` / `defaultOpen`: `Dialog`/`AlertDialog`/`Sheet` (`…Content > …Header > …Title`),
  `Select` (`SelectTrigger > SelectValue` + `SelectContent > SelectItem`), `DropdownMenu`, `Tabs`
  (`Tabs defaultValue > TabsList > TabsTrigger` + `TabsContent`).

## Styling idiom — Tailwind utilities mapped to tokens

Style with Tailwind utility classes; the design language lives in these token-backed families
(use these names rather than raw colors):

- **Surfaces:** `bg-background`, `bg-card`, `bg-secondary`, `bg-muted`, `bg-accent`, `bg-popover`,
  `bg-primary` (brand lime), `bg-destructive`.
- **Text:** `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `text-card-foreground`.
- **Borders/rings:** `border border-border`, `border-input` (inputs), `ring-primary` (focus).
- **Radius:** `rounded-xl`, `rounded-3xl` (cards/surfaces), `rounded-full` (buttons/badges/pills); base `--radius` = 1rem.
- **Shadow:** `shadow-soft` (resting), `shadow-md` (elevated/hover).
- **Type:** `font-sans` = Manrope (headings + body). `font-mono` = Roboto Mono, used UPPERCASE with
  wide tracking for buttons, badges, labels, breadcrumbs (e.g. `font-mono uppercase tracking-[0.14em]`).

## Where the truth lives

Read `_ds/<folder>/styles.css` (and its `@import`s) for the full token + utility set actually
shipped, and each component's `<Name>.prompt.md` / `<Name>.d.ts` for its real API.

## Idiomatic example

```tsx
<Card>
  <CardHeader>
    <CardTitle>Support agent</CardTitle>
    <CardDescription>Answers from your knowledge base.</CardDescription>
  </CardHeader>
  <CardContent className="text-sm text-muted-foreground">
    1,204 conversations handled this month.
  </CardContent>
  <CardFooter className="gap-2">
    <Button>Open</Button>
    <Button variant="outline">Configure</Button>
  </CardFooter>
</Card>
```

`Button` / `Badge` carry the brand via `variant` (default = lime primary; also `secondary`,
`outline`, `ghost`, `destructive`, `link`) and `Button` adds `size` (`sm` / `default` / `lg` / `icon`).
