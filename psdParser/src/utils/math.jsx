function r2(n) {
  return Math.round(n * 100) / 100
}

function r1(n) {
  return Math.round(n * 10) / 10
}

function dist(a, b) {
  return Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2))
}
