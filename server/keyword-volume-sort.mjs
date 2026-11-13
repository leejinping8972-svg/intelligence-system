// Match the displayed metric: only a nonnegative numeric estimate for this
// keyword's own market is sortable. JSON null/strings/other markets stay last.
export function keywordVolumeSql(sql) {
  return sql(
    `CASE WHEN jsonb_typeof(r.payload->'metrics'->'monthlySearchVolume')='number'
      THEN CASE WHEN r.payload->'metrics'->>'market'=r.market AND (r.payload->'metrics'->>'monthlySearchVolume')::numeric>=0
      THEN (r.payload->'metrics'->>'monthlySearchVolume')::numeric ELSE NULL END ELSE NULL END`,
    `CASE WHEN JSON_TYPE(JSON_EXTRACT(r.payload,'$.metrics.monthlySearchVolume')) IN ('INTEGER','DOUBLE','DECIMAL')
      THEN CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.metrics.market'))=r.market AND CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.metrics.monthlySearchVolume')) AS DECIMAL(40,6))>=0
      THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.metrics.monthlySearchVolume')) AS DECIMAL(40,6)) ELSE NULL END ELSE NULL END`,
  );
}
