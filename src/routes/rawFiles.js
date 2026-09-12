import { handleRequestCandidateFiles } from "helpers/common/staticCandidateFiles"

export function fileRoute (app, { mongo, router }) {
  router.route("/raw-candidates/:rawCandidateId").get(async function (req, res) {
    return await handleRequestCandidateFiles(req, res, { mongo })
  })
}
