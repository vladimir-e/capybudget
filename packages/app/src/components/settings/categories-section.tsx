import { Shapes } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function CategoriesSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <CardDescription>
          Manage the categories transactions are grouped into.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Shapes className="h-5 w-5" />
          </span>
          <p className="max-w-xs text-sm text-muted-foreground">
            Category management is moving here soon.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
