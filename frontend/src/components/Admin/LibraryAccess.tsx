import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Library } from "lucide-react"
import { useState } from "react"

import {
  type LibraryAccessPublic,
  type UserPublic,
  UsersService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { problemText } from "@/lib/apiError"

const MAX_REASON = 1000

const accessKey = (userId: string) => ["library-access", userId] as const

const timeText = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—"

function LibraryAccessDialog({
  user,
  onClose,
}: {
  user: UserPublic
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [reason, setReason] = useState("")
  const access = useQuery({
    queryKey: accessKey(user.id),
    retry: false,
    queryFn: async () =>
      (await UsersService.readLibraryAccess({ path: { user_id: user.id } }))
        .data as LibraryAccessPublic,
  })
  const update = useMutation({
    mutationFn: async (granted: boolean) =>
      (
        await UsersService.updateLibraryAccess({
          path: { user_id: user.id },
          body: { granted, reason: reason.trim() },
        })
      ).data as LibraryAccessPublic,
    onSuccess: (result) => {
      queryClient.setQueryData(accessKey(user.id), result)
      showSuccessToast(result.granted ? "已授予整库只读访问" : "已撤销整库访问")
      setReason("")
    },
    onError: (error) =>
      showErrorToast(problemText(error, "更新整库访问失败，请重试。")),
  })
  const trimmed = reason.trim()
  const reasonError =
    trimmed.length > MAX_REASON
      ? `理由最多 ${MAX_REASON} 个字符`
      : trimmed.length === 0
        ? "请填写理由"
        : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>整库只读访问</DialogTitle>
          <DialogDescription>
            {user.email}
            ：授予后该账号可只读浏览水迷宫整库实验与试次；这不会让管理员或该账号读取其他用户的项目与上传。
          </DialogDescription>
        </DialogHeader>
        {access.isPending && <p>正在读取当前授权…</p>}
        {access.error && (
          <p role="alert" className="text-destructive">
            {problemText(access.error, "无法读取当前授权。")}
          </p>
        )}
        {access.data && (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
            data-testid="library-access-state"
          >
            <dt>显式授权</dt>
            <dd>
              <Badge variant={access.data.granted ? "default" : "secondary"}>
                {access.data.granted ? "已授予" : "未授予"}
              </Badge>
            </dd>
            <dt>当前生效</dt>
            <dd>
              <Badge variant={access.data.effective ? "default" : "outline"}>
                {access.data.effective ? "生效" : "不生效"}
              </Badge>
              {user.is_superuser && (
                <span className="ml-2 text-muted-foreground">
                  管理员角色自带整库权限
                </span>
              )}
            </dd>
            <dt>理由</dt>
            <dd className="break-words">{access.data.reason ?? "—"}</dd>
            <dt>更新时间</dt>
            <dd>{timeText(access.data.updated_at)}</dd>
            <dt>操作人</dt>
            <dd className="break-all">{access.data.updated_by ?? "—"}</dd>
          </dl>
        )}
        <label className="grid gap-1 text-sm">
          <span>
            授予或撤销的理由 <span className="text-destructive">*</span>
          </span>
          <textarea
            className="min-h-20 rounded-md border bg-transparent p-2"
            aria-label="授权理由"
            aria-invalid={reasonError !== null && reason.length > 0}
            maxLength={MAX_REASON + 200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {reason.length > 0 && reasonError && (
            <span role="alert" className="text-destructive">
              {reasonError}
            </span>
          )}
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <LoadingButton
            variant="outline"
            loading={update.isPending}
            disabled={!access.data || reasonError !== null}
            onClick={() => update.mutate(false)}
          >
            撤销整库访问
          </LoadingButton>
          <LoadingButton
            loading={update.isPending}
            disabled={!access.data || reasonError !== null}
            onClick={() => update.mutate(true)}
          >
            授予整库只读访问
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function LibraryAccess({
  user,
  onSuccess,
}: {
  user: UserPublic
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => event.preventDefault()}
        onClick={() => setOpen(true)}
      >
        <Library />
        整库访问
      </DropdownMenuItem>
      {open && (
        <LibraryAccessDialog
          user={user}
          onClose={() => {
            setOpen(false)
            onSuccess()
          }}
        />
      )}
    </>
  )
}
