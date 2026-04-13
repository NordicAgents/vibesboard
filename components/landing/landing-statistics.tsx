'use client'

export function LandingStatistics() {
  const statistics = [
    {
      label: 'Active Agents',
      value: '10,000+'
    },
    {
      label: 'Conversations',
      value: '1M+'
    },
    {
      label: 'Insights Generated',
      value: '500K+'
    },
    {
      label: 'User Satisfaction',
      value: '98%'
    }
  ]

  return (
    <section className="border-y border-black-10 bg-purewhite-bg py-16 md:py-24">
      <div className="container mx-auto max-w-7xl px-6 lg:px-12">
        {/* Grid layout for all screen sizes - NORRE style */}
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-4 lg:gap-12">
          {statistics.map((stat, index) => (
            <div key={index} className="text-center">
              <div className="mb-2 font-switzer text-5xl font-bold text-black-primary md:text-6xl lg:text-7xl">
                {stat.value}
              </div>
              <div className="font-switzer text-base text-gray-secondary md:text-lg">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
