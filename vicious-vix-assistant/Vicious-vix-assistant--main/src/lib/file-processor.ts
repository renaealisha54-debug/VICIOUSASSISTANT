import JSZip from "jszip";

export interface ProcessedFile {
  name: string;
  type: "image" | "zip" | "text" | "binary";
  content: string | ArrayBuffer;
  extractedFiles?: { name: string; content: string }[];
}

export async function processUploadedFile(file: File): Promise<ProcessedFile> {
  const isZip = file.name.endsWith(".zip") || file.type === "application/zip";
  const isImage = file.type.startsWith("image/");

  if (isImage) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: "image", content: reader.result as string });
      reader.readAsDataURL(file);
    });
  }

  if (isZip) {
    const zip = new JSZip();
    const contents = await zip.loadAsync(file);
    const extractedFiles: { name: string; content: string }[] = [];

    for (const relativePath of Object.keys(contents.files)) {
      const zipEntry = contents.files[relativePath];
      if (!zipEntry.dir) {
        // Read text/code files inside the zip
        const textContent = await zipEntry.async("string");
        extractedFiles.push({ name: relativePath, content: textContent });
      }
    }

    return {
      name: file.name,
      type: "zip",
      content: `Extracted ${extractedFiles.length} files from ${file.name}`,
      extractedFiles
    };
  }

  // Default text/file reader
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: "text", content: reader.result as string });
    reader.readAsText(file);
  });
}
