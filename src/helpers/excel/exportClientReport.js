import excel from "exceljs"
import _ from "lodash"
import { Stream } from "stream"

function appendWorksheet(worksheet, options = {}) {
  if (!_.isEmpty(options.data)) {
    options.data.forEach((d, index) => {
      let row = worksheet.addRow(d)
      row.eachCell((cell, number) => {
        cell.font = { name: "Roboto", size: 10 }
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        }

        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        }
      })
      row.commit()
    })
  }
}


function exportClientReport({data = [], headerOptions = {}}) {
  const stream = new Stream.PassThrough()
  let workbook = new excel.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: true,
  })

  workbook.creator = process.env.APP_NAME
  workbook.lastModifiedBy = process.env.APP_NAME
  workbook.created = new Date()
  workbook.modified = new Date()

  let sheet = workbook.addWorksheet("Report")

  sheet.addRow(["Client Report Period", headerOptions.title])
  sheet.addRow(["Report Exported Date & Time", headerOptions.time])

  const headerStyle = { size: 14, bold: true }
  sheet.getRow(1).font = headerStyle
  sheet.getRow(2).font = headerStyle
  sheet.addRow([])

  let jobOrderHeader = ["Client", "Amount"]
  
  const headerJobOrderRow = sheet.addRow(jobOrderHeader)
  headerJobOrderRow.eachCell((cell, number) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF" },
    }
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    }
    cell.font = {
      name: "Roboto",
      size: 10,
      bold: true,
      color: { argb: "#000000" },
    }
    cell.alignment = { vertical: "middle", horizontal: "center" }
    sheet.getColumn(number).width = 30
  })
  headerJobOrderRow.commit()
  appendWorksheet(sheet, { data: data })

  workbook.commit()
  return workbook.stream
}

export default exportClientReport