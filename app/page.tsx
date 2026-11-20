import Link from "next/link";
import { crmMode } from "@/lib/crm";
import { getDb } from "@/lib/db";
import { listClinics } from "@/lib/queries";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default function Home() {
  const clinics = listClinics(getDb());
  const mode = crmMode();

  return (
    <main className="page">
      <p className="eyebrow">Frontdesk</p>
      <h1>WhatsApp front desk for clinics</h1>
      <p className="lede">
        Patients message the clinic on WhatsApp. The assistant answers pricing, hours and address
        questions, shows real availability and books the appointment. Contacts and appointments sync
        into HighLevel; staff see every conversation and booking in one place.
      </p>

      <div style={{ marginBottom: 24 }}>
        {mode === "highlevel" ? (
          <span className="badge ok">HighLevel connected</span>
        ) : (
          <span className="badge">Local mode · set GHL_API_TOKEN to sync contacts and calendars</span>
        )}
      </div>

      <div className="grid">
        {clinics.map((clinic) => (
          <Link key={clinic.id} href={`/clinics/${clinic.id}`} className="panel card-link">
            <h2>{clinic.name}</h2>
            <div className="note">
              {clinic.address} · {clinic.hoursNote}
            </div>
            <div className="stats">
              <div>
                <div className="stat-value">{clinic.conversations}</div>
                <div className="stat-label">Conversations</div>
              </div>
              <div>
                <div className="stat-value">{clinic.bookings}</div>
                <div className="stat-label">Open bookings</div>
              </div>
              <div>
                <div className="stat-value">{clinic.openJobs}</div>
                <div className="stat-label">Queued jobs</div>
              </div>
            </div>
            <div className="note">
              {clinic.nextAppointment
                ? `Next appointment: ${formatDateTime(clinic.nextAppointment, clinic.timezone)}`
                : "No upcoming appointments"}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
