import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** 인증 앱에 등록할 QR과 손으로 넣을 비밀 값. */
export function TotpQr({ otpauthUri }: { otpauthUri: string }) {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void QRCode.toDataURL(otpauthUri, { margin: 1, width: 192 }).then((url) => alive && setImage(url))
    return () => {
      alive = false
    }
  }, [otpauthUri])
  const secret = new URL(otpauthUri).searchParams.get('secret') ?? ''
  return (
    <div className="flex flex-col items-center gap-2">
      {image === null ? (
        <div className="bg-muted size-48 rounded-md" />
      ) : (
        <img src={image} alt="인증 앱 등록 QR" className="size-48 rounded-md bg-white" />
      )}
      <code className="text-muted-foreground text-xs break-all">{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
    </div>
  )
}
