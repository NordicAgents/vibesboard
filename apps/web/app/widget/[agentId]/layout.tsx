export default function WidgetLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      {children}
    </div>
  )
}
