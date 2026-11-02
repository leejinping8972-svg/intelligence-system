export function passwordPolicy(password) {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 128
  )
    throw new Error('密码长度需要8～128个字符');
}
