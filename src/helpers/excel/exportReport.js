import excel from "exceljs"
import _ from "lodash"
import { Stream } from "stream"

function appendWorksheet(worksheet, options = {}) {
  if (!_.isEmpty(options.data)) {
    options.data.forEach((d, index) => {
      let row = worksheet.addRow(d)
      if (d[18] === true) {
        row.fill = {
          type: 'pattern',
          pattern:'solid',
          fgColor:{argb:'fffee2e2'},
          bgColor:{argb:'fffee2e2'}
        }
      }
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


function exportReport({jobOrders = [], externalSales = [], headerOptions = {}}) {
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

  sheet.addRow(["Consultant", headerOptions.consultant])
  sheet.addRow(["Month", headerOptions.date])
  sheet.addRow(["Status", "Closure"])
  sheet.addRow(["Total Closure Sales", `$${headerOptions.totalSales}`])
  const headerStyle = { size: 14 }
  sheet.getRow(1).font = headerStyle
  sheet.getRow(2).font = headerStyle
  sheet.getRow(3).font = headerStyle
  sheet.getRow(4).font = headerStyle
  sheet.addRow([])

  let jobOrderHeader = [ 
    "No", "Company", "Job Title", "Candidate", "Business Segment", "Start Date", 
    "Guarantee Period", "Consultant", "Salary", "Billing(%)", "Other Fees", 
    "Placement Fees", "Remarks", 
  ]
  let externalSaleHeader = ["No", "Owner", "Type of Fee", "Candidate / Details", "Amount"]
  
  // Job order report
  sheet.addRow(["Job Order Report", `$${headerOptions.totalJobOderSales}`])
  sheet.getRow(6).font = headerStyle
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
  appendWorksheet(sheet, { data: jobOrders })

  // External Sale Report
  sheet.addRow([])
  sheet.addRow(["External Sale Report", `$${headerOptions.totalExternalSales}`])
  sheet.getRow(parseInt(jobOrders.length + 9)).font = headerStyle
  const headerExternalSaleRow = sheet.addRow(externalSaleHeader)
  headerExternalSaleRow.eachCell((cell, number) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF" },
    }
    cell.border = {
      top: { style: "thin", },
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
  headerExternalSaleRow.commit()
  appendWorksheet(sheet, { data: externalSales })
  workbook.commit()
  return workbook.stream
}

export default exportReport