import exportReport from "helpers/excel/exportReport"

export const excelRoute = (app, { mongo, router }) => {
  router.route("/export/report/:reportId").get(async function (req, res) {
    return await exportReport(req, res, { mongo })
  })
}
