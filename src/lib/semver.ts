// Minimal major.minor.patch comparator — deliberately not a full semver parser
// (no pre-release/build metadata support) since every version in this project
// follows that exact shape.
function parseVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10))
  return [major || 0, minor || 0, patch || 0]
}

// Negative if a < b, positive if a > b, zero if equal.
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a)
  const [bMajor, bMinor, bPatch] = parseVersion(b)

  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  return aPatch - bPatch
}
