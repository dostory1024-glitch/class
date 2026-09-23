export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function textField(value, label, max) {
  if (typeof value !== 'string' || !value.trim()) throw new InputError(`${label}을 입력해 주세요.`);
  const text = value.trim();
  if ([...text].length > max) throw new InputError(`${label}은 ${max}자 이내로 입력해 주세요.`);
  return text;
}

export function validateStoryFields(body) {
  const nickname = textField(body?.nickname, '닉네임', 20);
  const intended = textField(body?.intended, '의도한 수업', 200);
  const actual = textField(body?.actual, '실제로 이루어진 수업', 200);
  return { nickname, intended, actual };
}

export function validateStory(body) {
  const fields = validateStoryFields(body);
  if (typeof body.requestId !== 'string' || !/^[\w-]{16,80}$/.test(body.requestId)) throw new InputError('제출 요청을 확인할 수 없습니다. 다시 시도해 주세요.');
  return { ...fields, requestId: body.requestId };
}
