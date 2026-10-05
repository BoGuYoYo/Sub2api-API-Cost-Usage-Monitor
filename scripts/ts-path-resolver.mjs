/**
 * Node ESM resolver hook for the verification script.
 *
 * The app is bundled by Vite, which resolves extension-less TypeScript imports
 * (`./api`). Plain Node ESM needs the real file name, so this hook appends `.ts`
 * to relative imports that have no extension before delegating to Node.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$|\.json$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall back to the original specifier below.
    }
  }
  return nextResolve(specifier, context);
}
