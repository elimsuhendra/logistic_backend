const Utils = () => {
  String.prototype.lowerCaseFirstChar = function() {
    return this.charAt(0).toLocaleLowerCase() + this.slice(1)
  }
  String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1).toLowerCase()
  }
  String.prototype.nameId = function() {
    return `${this}Id`.lowerCaseFirstChar()
  }
  String.prototype.nameIds = function() {
    return `${this}Ids`.lowerCaseFirstChar()
  }
  Array.prototype.removeElements = function(els) {
    return this.filter(item => !els.includes(item))
  }
}

export const mongoURI = ({
  protocol = 'mongodb',
  host = 'localhost:27017',
  name = '',
  username = '',
  password = '',
  params = ''
}) => {
  let authenticate = !username || username === '' ? '' : `${username}:${password}@`
  return `${protocol}://${authenticate}${host}/${name}?${params}`
}

export default Utils
