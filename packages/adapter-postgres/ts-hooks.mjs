/**
 * Node.js module hooks that allow extensionless TypeScript imports.
 * Needed because --experimental-strip-types does not auto-try .ts extensions.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    try {
      return await nextResolve(specifier + '.ts', context)
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context)
}
