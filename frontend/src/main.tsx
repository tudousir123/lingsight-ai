import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { AxiosError } from "axios"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { client } from "./client/client.gen"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "./components/ui/sonner"
import "./index.css"
import { getToken, TOKEN_STORAGE_KEY } from "./lib/credentials"
import { routeTree } from "./routeTree.gen"

client.setConfig({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  auth: () => getToken() ?? "",
})

const handleApiError = (error: Error) => {
  if (
    error instanceof AxiosError &&
    (error.response?.status === 401 ||
      (error.response?.status === 403 &&
        error.response?.data?.detail === "Could not validate credentials"))
  ) {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    window.location.href = "/login"
  }
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleApiError,
  }),
  mutationCache: new MutationCache({
    onError: handleApiError,
  }),
})

// Clear landing-page anchors before the router reads the initial location.
// A refresh should open the hero; explicit links to sections still work.
const navigation = performance.getEntriesByType("navigation")[0] as
  | PerformanceNavigationTiming
  | undefined
if (
  navigation?.type === "reload" &&
  window.location.pathname === "/welcome" &&
  window.location.hash
) {
  const landingUrl = new URL(window.location.href)
  landingUrl.hash = ""
  window.history.replaceState(window.history.state, "", landingUrl)
}

const router = createRouter({ routeTree })
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
