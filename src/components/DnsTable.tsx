// DNS records for a team to add at its domain provider.
export default function DnsTable({ rows }: { rows: { type: string; name: string; value: string; priority?: number; status?: string }[] }) {
  const priority = rows.some((r) => r.priority !== undefined);
  const status = rows.some((r) => r.status);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="text-muted">
          <tr>
            <th className="py-1 pr-4 font-normal">Type</th>
            <th className="py-1 pr-4 font-normal">Name</th>
            <th className="py-1 pr-4 font-normal">Value</th>
            {priority && <th className="py-1 pr-4 font-normal">Priority</th>}
            {status && <th className="py-1 font-normal">Found</th>}
          </tr>
        </thead>
        <tbody className="font-mono text-xs">
          {rows.map((r) => (
            <tr key={`${r.type}${r.name}${r.value}`}>
              <td className="py-1 pr-4 align-top">{r.type}</td>
              <td className="break-all py-1 pr-4 align-top">{r.name}</td>
              <td className="break-all py-1 pr-4 align-top">{r.value}</td>
              {priority && <td className="py-1 pr-4 align-top">{r.priority ?? ""}</td>}
              {status && <td className="py-1 align-top font-sans">{r.status === "verified" ? "Yes" : "Not yet"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
