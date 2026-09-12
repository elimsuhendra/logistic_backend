import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import axios from "axios"
import { tmpdir } from "os"
import textract from "textract"

export const extractName = (text) => {
  const regex = /name ?:(.*)(.|\n)/gi
  const result = regex.exec(text) || []
  if (result.length) {
    return (result[1] || "").trim()
  }
  const firstLineNameReg = /([a-z]{1,9}[ \n]?){1,4}/i
  const rs = firstLineNameReg.exec(text)
  return rs && rs.length && rs[0] || ""
}

export const extractNationality = (text) => {
  const regex = /(nationality|country) ?:(.*)(.|\n)/gi
  const result = regex.exec(text) || []
  return (result[2] || "").trim()
}

export const extractGender = (text) => {
  const regex = /(gender|sex) ?:(.*)(.|\n)/gi
  const result = regex.exec(text) || []
  return (result[2] || "").trim()
}

export const extractDOB = (text) => {
  const regex = /(date of birth|dob|day of birth|birthday) ?:(.*)(.|\n)/gi
  const result = regex.exec(text) || []
  return (result[2] || "").trim()
}

export const extractDesignation = (text) => {
  const regex = /designation ?:(.*)(.|\n)/gi
  const result = regex.exec(text) || []
  return (result[1] || "").trim()
}

export const extractEmail = (text) => {
  // const regex = /([a-z0-9_\.-]+)@([\da-z\.-]+)\.([a-z\.]{2,6})/gi
  const regex = /(email|mail) ?:(.*)(.|\n)/gi
  const result = regex.exec(text) || []
  return (result[2] || "").trim()
}

export const extractPhone = (text) => {
  // const regex = /((?:\+?\d{1,3}[\s-])?\(?\d{2,3}\)?[\s.-]?\d{3}[\s.-]?\d{4,5})/gi
  const regex = /(mobile|tel|phone) ?:(.*)(.|\n)/gi
  const result = regex.exec(text) || []
  return (result[2] || "").trim()
}

const getFile = async (url) => {
  try {
    const fileName = url.split("/").pop()
    const filePath = path.join(tmpdir(), `${fileName}.${fileName.split("-").pop()}`)
    const response = await axios.get(url, {
      method: "get",
      responseType: "stream",
    })
    response.data.pipe(fs.createWriteStream(filePath))

    return filePath
  } catch (error) {
    console.log(error)
    return null
  }
}

export const parseResume = async (resumeUrl) => {
  try {
    return await new Promise(async (resolve, reject) => {
      const filePath = await getFile(resumeUrl)
      if (filePath) {
        const textractResult = await new Promise((rs) => {
          textract.fromUrl(
            resumeUrl,
            {
              preserveLineBreaks: true,
            },
            (e, text) => {
              if (e) {
                console.log(e)
                return rs({})
              }
              const name = extractName(text)
              const phone = extractPhone(text)
              const email = extractEmail(text)
              const nationality = extractNationality(text)
              const gender = extractGender(text)
              const dob = extractDOB(text)
              const designation = extractDesignation(text)
              rs({
                name,
                nationality,
                gender,
                dob,
                designation,
                phone,
                email
              })
            }
          )
        })
        const pyProg = spawn("pyresparser", ["-e", "json", "-f", filePath])
        let log = ""
        pyProg.stdout.on("data", function (data) {
          log += data.toString()
        })
        pyProg.stdout.on("end", () => {
          if (log.includes("not found")) {
            return reject(new Error("Pyresparser not found."))
          }
          const text = log
            .split("'")
            .filter((t) => t !== "\n " && t !== "\n\r ")
            .join("")
            .replace(/\\\\u.{4}/g, "")
          const matched = text.match(/(\[(.*)\])/)
          const json = matched.length ? JSON.parse(matched[0]) : null
          fs.unlinkSync(filePath)
          resolve([
            {
              ...json[0],
              ...textractResult,
              name: textractResult.name || json[0].name,
              email: textractResult.email || json[0].email,
              mobile_number: textractResult.phone || json[0].mobile_number,
            },
          ])
        })
      }
    })
  } catch (error) {
    return {}
  }
}
