import { redirect } from "next/navigation";

// Konfiguratoren bor i shoppen på forsiden, men den fortjener sin egen adresse —
// den er nem at huske, og admin-testpanelet kræver at man lander her fra /admin i
// samme faneblad.
export default function NoegleringPage() {
  redirect("/?noglering");
}
