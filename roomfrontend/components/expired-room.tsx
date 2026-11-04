"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Clock3 } from "lucide-react"

interface ExpiredRoomProps {
  onReset: () => void
}

export default function ExpiredRoom({ onReset }: ExpiredRoomProps) {
  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="gap-3">
        <div className="flex size-10 items-center justify-center rounded-full border border-border bg-muted/40">
          <Clock3 className="size-4 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <CardTitle role="heading" aria-level={1} className="text-xl tracking-tight">
            This room is gone
          </CardTitle>
          <CardDescription>
            It self-destructed after a period of inactivity. There is no history to recover — that
            is the point.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button onClick={onReset} className="w-full">
          Create a new room
        </Button>
      </CardContent>
    </Card>
  )
}
