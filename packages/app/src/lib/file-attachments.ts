const TEXT_EXTENSIONS = new Set([".csv", ".tsv", ".json", ".xml", ".md", ".txt", ".log"])

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true
  if (file.type === "application/json" || file.type === "application/xml") return true
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
