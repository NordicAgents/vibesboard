import QRCode from 'qrcode'

export async function getQrDataUrl(url: string) {
  return QRCode.toDataURL(url, {
    margin: 1,
    width: 512
  })
}
