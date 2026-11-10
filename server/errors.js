'use strict';
class HttpError extends Error {
  constructor(status, message, code, details) { super(message); this.status=status; this.code=code; this.details=details; }
}
function bad(message='البيانات المرسلة غير صالحة.') { throw new HttpError(400,message,'INVALID_DATA'); }
module.exports={HttpError,bad};
