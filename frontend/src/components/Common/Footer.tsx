import { Link } from "@tanstack/react-router"

export function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t py-4 text-xs text-muted-foreground">
      <span>© {new Date().getFullYear()} LingSight Science</span>
      <Link to="/welcome" className="hover:text-foreground">
        产品首页
      </Link>
    </footer>
  )
}
