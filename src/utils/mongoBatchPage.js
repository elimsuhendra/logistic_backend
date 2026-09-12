export function mongoBatchPage(options) {
  const batch = new MongoBatchPage(options);
  return batch;
}

export class MongoBatchPage {
  constructor(options) {
    this.options = options;
    this.limit = options["limit"] || 1000;
  }

  preLoad(preLoader) {
    this.preLoader = preLoader;
    return this;
  }

  load(loader) {
    this.loader = loader;
    return this;
  }

  async run(runner) {
    this.runner = runner;

    const result = await this.preLoader();
    this.totalRecord = !!result ? result : 0;

    let page = 0;

    while (true) {
      const skip = page * this.limit;
      try {
        const result = await this.loader(this.limit, skip);
        if (
          result === null ||
          result === undefined ||
          (Array.isArray(result) && result.length === 0)
        ) {
          if (typeof this.ender === "function") this.ender();
          break;
        }
        await this.runner(result);

        if (typeof this.afterRun === "function") {
          const currentLength = skip + this.limit;
          const processing = Math.round(
            (currentLength / this.totalRecord) * 100
          );
          this.afterRun(processing < 90 ? processing : 90);
        }

        page++;
      } catch (err) {
        console.log("Error when processing mongo batch page", err);
        if (typeof this.ender === "function") this.ender();
        break;
      }
    }
  }

  onAfterRun(afterRunner) {
    this.afterRun = afterRunner;
    return this;
  }

  onended(ender) {
    this.ender = ender;
    return this;
  }
}
