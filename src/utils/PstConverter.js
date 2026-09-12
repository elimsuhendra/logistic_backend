import cheerio from "cheerio"
import fs from "fs"
import glob from "glob"
import path from "path"
import { PSTFile } from "pst-extractor"
import { convert } from 'html-to-text'
import chunk from "lodash/chunk"

const ANSI_RED = 31
const ANSI_BLUE = 34
const verbose = false
const highlight = (str, code = ANSI_RED) => "\u001b[" + code + "m" + str + "\u001b[0m"

export async function extractPstFiles(inputDir, outputDir, callback) {
  const outDir = outputDir || path.resolve(inputDir, "../out")
  return new Promise(resolve => {
    glob("**/*.pst", {
      cwd: inputDir
    }, async function (err, files) {
      if (!err) {
        for (let file of files) {
          const filename = path.parse(file).name
          const destination = path.resolve(outDir, filename)
          const source = path.resolve(inputDir, file)
  
          if (!fs.existsSync(destination)) {
            fs.mkdirSync(destination, { recursive: true })
          }
          await extractSinglePstFile(filename, source, destination, callback)
        }
      } else {
        console.log("[ERROR] Error when trying read dir", err)
      }
  
      resolve()
    })
  })
}

async function extractSinglePstFile(pstFileName, inputFile, destination, callback) {
  const pstFile = new PSTFile(path.resolve(inputFile))

  await processFolder(pstFileName, pstFile.getRootFolder(), destination)

  async function processFolder(fileSource, folder, destination) {
    // go through the folders...
    if (folder.hasSubfolders) {
      let childFolders = folder.getSubFolders()
      const chunks = chunk(childFolders, 50)
      for (let folders of chunks) {
        await Promise.all(folders.map((folder) => processFolder(fileSource, folder, destination)))
      }
    }

    // and now the emails for this folder
    if (folder.contentCount > 0) {
      let email = folder.getNextChild()
      let buffers = []
      while (email != null) {
        buffers.push(email)
        if (buffers.length >= 200) {
          await Promise.all(buffers.map(email => extractEmailData(fileSource, email, destination, callback)))
          buffers = []
        }
        email = folder.getNextChild()
      }
      if (buffers.length >= 0) {
        await Promise.all(buffers.map((email) => extractEmailData(fileSource, email, destination, callback)))
      }
    }
  }

  async function extractEmailData(fileSource, email, destination, callback) {
    if (email.hasAttachments) {
      const dir = path.resolve(destination, "attachments", email.descriptorNodeId.toString())
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const attachmentCount = email.numberOfAttachments
      for (let i = 0; i < attachmentCount; i++) {
        const attachment = email.getAttachment(i)
        if (attachment.filename) {
          const filename = dir + "/" + attachment.longFilename
          if (verbose) {
            console.log(highlight("saving attachment to " + filename, ANSI_BLUE))
          }
          try {
            const fd = fs.openSync(filename, "w")
            const attachmentStream = attachment.fileInputStream
            if (attachmentStream) {
              const bufferSize = 8176
              const buffer = Buffer.alloc(bufferSize)
              let bytesRead

              do {
                bytesRead = attachmentStream.read(buffer)
                fs.writeSync(fd, buffer, 0, bytesRead)
              } while (bytesRead == bufferSize)
              fs.closeSync(fd)
              const json = await Extractor.getJson(filename, { attachmentDir: dir, fileSource })
              await callback(json)
            }
          } catch (err) {
            console.error(err)
          }
        }
      }
    }
  }
}

// const READABLE_AS_TEXT = [".html", ".htm", ".doc", ".docx", ".txt", ".pdf"]
const READABLE_AS_TEXT = [".html", ".htm"]

export class Extractor {

  static async getJson(filePath, context) {
    const { attachmentDir, fileSource } = context
    const isReadableAsText = READABLE_AS_TEXT.includes(path.parse(filePath).ext.toLowerCase())
    if (!isReadableAsText) return null

    return new Promise(function (resolve, reject) {
      function handler(error, text) {
        if (error) {
          reject(error)
        } else {
          resolve(text)
        }
      }

      fs.readFile(filePath, "utf8", (err, htmlData) => {
        if (err) {
          console.error(err)

          return handler(err, null)
        }
        const $ = cheerio.load(htmlData)
        let fullName = cheerioExtractText($(".resume-preview-container-content .formSection .pageRow .resume-header .resume-header-top .colLeft.main-heading.space-gap_front"), $),
          phone = cheerioExtractText($(".resume-preview-container-content .formSection .resume-header-inner .resume-section-top-right .new-pageRow .colMiddle.resume-summary-heading").first(), $),
          email = cheerioExtractText($(".resume-preview-container-content .formSection .resume-header-inner .resume-section-top-right .new-pageRow .colMiddle.resume-summary-heading.long-text-word").first(), $),
          nationality = cheerioExtractText($("*:contains(\"Nationality\")").next(".col-middle"), $)

        const fullText = convert(htmlData, { wordwrap: false })
        if (!fullName) return handler(null, null)

        email = String(email).toLowerCase()

        const data = {
          fileName: path.parse(filePath).base,
          filePath,
          fullName,
          phone,
          email,
          nationality,
          attachmentDir,
          fileSource,
          fullText,
          htmlData,
        }

        handler(null, data)
      })
    })
  }
}

function cheerioExtractText(element, $) {
  if (!element) return null
  if (element.type === "text") {
    return $(element).text().trim()
  } else {
    return $(element).contents().toArray().map(e => cheerioExtractText(e, $)).filter(Boolean).join(" ")
  }
}