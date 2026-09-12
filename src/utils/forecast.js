import buildMongoFilters from "src/utils/buildMongoFilters.js";
import moment from "moment";
import _ from "lodash";
import { prepareCreate } from "src/utils/model";

export async function cloneForecastsByYear({ year }, context) {
  console.log('Cloning all forecasts for year', year);
  const { mongo } = context;
  const forecasts = await mongo.Forecast.find(
    buildMongoFilters({
      AND: [
        { year_gte: moment({ year }).startOf("year").valueOf() },
        { year_lte: moment({ year }).endOf("year").valueOf() },
      ],
      adjusted_in: [false, null],
    }),
  ).toArray();

  if (!forecasts.length) {
    throw new Error(`No forecasts found for year ${year}`);
  }

  return await cloneForecasts({ forecasts }, context);
}

export async function cloneForecasts({ forecasts }, { mongo }) {
  const newForecasts = forecasts
    .filter((forecast) => !forecast.adjusted)
    .map((forecast) => {
      return {
        ..._.omit(forecast, ["_id", "createdAt", "updatedAt"]),
        originalId: forecast._id,
        adjusted: true,
      };
    });

  const bulkWriteArgs = newForecasts
    .map((forecast) => ({
      updateOne: {
        filter: buildMongoFilters({
          groupId: forecast.groupId,
          userId: forecast.userId,
          year: forecast.year,
          adjusted: true,
        }),
        update: {
          $set: {},
          $setOnInsert: prepareCreate(forecast),
        },
        upsert: true,
      },
    }))
    .filter(Boolean);
  if (bulkWriteArgs.length) {
    return _.flatten(
      await Promise.all(
        _.chunk(bulkWriteArgs, 40).map(async (args) => {
          await mongo.Forecast.bulkWrite(args, { ordered: false });
        }),
      ),
    );
  }
  return [];
}
