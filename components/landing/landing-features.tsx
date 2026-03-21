export function LandingFeatures() {
 const features = [
 {
 title: "Build Agents",
 description: "Create custom AI agents tailored to your needs. Design conversation flows, set personalities, and configure behaviors that match your goals.",
 },
 {
 title: "Record Vibes",
 description: "Capture authentic interactions as your agents engage with people. Every conversation, response, and nuance is recorded for deep analysis.",
 },
 {
 title: "AI Insights",
 description: "Unlock the real vibe with advanced AI analysis. Understand sentiment, detect patterns, and gain insights that matter from every interaction.",
 }
 ]

 return (
 <section id="features" className="bg-beige-bg py-20 md:py-32">
 <div className="container mx-auto max-w-7xl px-6 lg:px-12">
 {/* Section header */}
 <div className="mx-auto mb-16 max-w-4xl text-center md:mb-20">
 <h2 className="mb-6 font-switzer text-h2 font-bold text-black-primary">
 Everything you need to understand the vibe
 </h2>
 <p className="font-switzer text-lg text-gray-secondary md:text-xl">
 Build, deploy, and analyze AI agents that capture authentic human interactions
 </p>
 </div>

 {/* Features grid - NORRE style */}
 <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8">
 {features.map((feature, index) => (
 <div
 key={index}
 className="group rounded-3xl border border-black-10 bg-purewhite-bg p-8 transition-all duration-300 hover:border-black-25 hover:shadow-lg lg:p-10"
 >
 <h3 className="mb-4 font-switzer text-2xl font-semibold text-black-primary lg:text-3xl">
 {feature.title}
 </h3>
 <p className="font-switzer text-base leading-relaxed text-gray-secondary lg:text-lg">
 {feature.description}
 </p>
 </div>
 ))}
 </div>
 </div>
 </section>
 )
}
