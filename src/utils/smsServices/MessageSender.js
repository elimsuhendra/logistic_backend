

export default class MessageSender {
  constructor(props) {
    this.config(props)
  }

  config(options) {
    this.configuration = options
  }

  async send(args = {}) {
    throw new Error("send(args = {}) must be implemented first")
  }
}