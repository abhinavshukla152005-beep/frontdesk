import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getClinicDashboard } from "@/lib/queries";
import { formatDateTime } from "@/lib/time";
import ChatTester from "./ChatTester";

export const dynamic = "force-dynamic";

export default async function ClinicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dashboard = getClinicDashboard(getDb(), id);
  if (!dashboard) notFound();

  const { clinic, metrics, conversations, appointments } = dashboard;
  const response =
    metrics.medianFirstResponseMin === null ? "—" : `${metrics.medianFirstResponseMin} min`;

  return (
    <main className="page">
      <Link href="/" className="badge">
        Back
      </Link>
      <p className="eyebrow" style={{ marginTop: 20 }}>
        {clinic.whatsappNumber} · {clinic.timezone}
      </p>
      <h1>{clinic.name}</h1>
      <p className="lede" style={{ marginBottom: 24 }}>
        {clinic.address} · {clinic.hoursNote}
      </p>

      <div className="metrics">
        <div className="metric">
          <div className="stat-value">{metrics.conversations}</div>
          <div className="stat-label">Conversations</div>
        </div>
        <div className="metric">
          <div className="stat-value">{metrics.bookings}</div>
          <div className="stat-label">Open bookings</div>
        </div>
        <div className="metric">
          <div className="stat-value">{response}</div>
          <div className="stat-label">Median first reply</div>
        </div>
        <div className="metric">
          <div className="stat-value">{metrics.inbound}</div>
          <div className="stat-label">Messages in</div>
        </div>
        <div className="metric">
          <div className="stat-value">{metrics.outbound}</div>
          <div className="stat-label">Messages out</div>
        </div>
        <div className="metric">
          <div className="stat-value">{metrics.cancelled}</div>
          <div className="stat-label">Cancelled</div>
        </div>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Try the assistant</h2>
          <p className="note" style={{ marginTop: 0 }}>
            Sends a synthetic inbound message through the same ingest path as the WhatsApp webhook.
          </p>
          <ChatTester clinicId={clinic.id} />
        </section>

        <section className="panel">
          <h2>Upcoming and recent appointments</h2>
          {appointments.length === 0 ? (
            <p className="empty">No appointments yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Service</th>
                  <th>Patient</th>
                  <th>Status</th>
                  <th>HighLevel</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{formatDateTime(appointment.startMs, clinic.timezone)}</td>
                    <td>{appointment.serviceName}</td>
                    <td>{appointment.patientPhone}</td>
                    <td>
                      <span className={`badge ${appointment.status === "booked" ? "ok" : "cancelled"}`}>
                        {appointment.status}
                      </span>
                    </td>
                    <td>{appointment.externalId ? <span className="badge ok">{appointment.externalId}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Conversations</h2>
        {conversations.length === 0 ? (
          <p className="empty">No conversations yet. Send a message above to start one.</p>
        ) : (
          conversations.map((conversation) => (
            <div className="chat" key={conversation.id}>
              <div className="chat-head">
                <strong style={{ fontSize: 13 }}>{conversation.patientPhone}</strong>
                <span style={{ display: "flex", gap: 8 }}>
                  {conversation.needsHuman ? <span className="badge human">needs human</span> : null}
                  <span className="badge">{formatDateTime(conversation.lastMessageAt, clinic.timezone)}</span>
                </span>
              </div>
              <div className="bubbles">
                {conversation.messages.map((message) => (
                  <div key={message.id} className={`bubble ${message.direction}`}>
                    {message.body}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
