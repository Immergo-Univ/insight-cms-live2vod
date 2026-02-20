export const config = {
  insightApiBase: process.env.INSIGHT_API_BASE || "https://insight-api-frankly.univtec.com",
  insightAuthToken: process.env.INSIGHT_AUTH_TOKEN || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImV6ZXF1aWVsLnBhb2xpbGxvQHVuaXZ0ZWMuY29tIiwic3ViIjoiNjFiMjFmZjNmM2I1ZGM2YjAzZGMyNzMzIiwiaWF0IjoxNzcxMDk4MjQ0LCJleHAiOjE3NzE5OTgyNDR9.6nZAB82burrTNQh9u0xCH4O_ILQMORWYfmwtyiDY1xc",
  port: process.env.PORT || 3001,
};
