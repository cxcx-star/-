package ct;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 极简 JSON：只依赖 java.util。数字用 Long / Double，对象用 LinkedHashMap，数组用 ArrayList。 */
public final class Json {

    public static final class ParseException extends RuntimeException {
        public ParseException(String m) { super(m); }
    }

    private final String s;
    private int i;

    private Json(String s) { this.s = s; this.i = 0; }

    public static Object parse(String text) {
        Json p = new Json(text);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i < p.s.length()) throw new ParseException("trailing data at " + p.i);
        return v;
    }

    private void ws() {
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
            else break;
        }
    }

    private char peek() {
        if (i >= s.length()) throw new ParseException("unexpected end");
        return s.charAt(i);
    }

    private Object value() {
        char c = peek();
        switch (c) {
            case '{': return object();
            case '[': return array();
            case '"': return string();
            case 't': expect("true"); return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null"); return null;
            default: return number();
        }
    }

    private void expect(String lit) {
        if (!s.startsWith(lit, i)) throw new ParseException("bad literal at " + i);
        i += lit.length();
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        i++; // {
        ws();
        if (peek() == '}') { i++; return m; }
        while (true) {
            ws();
            String k = string();
            ws();
            if (peek() != ':') throw new ParseException("expected : at " + i);
            i++;
            ws();
            m.put(k, value());
            ws();
            char c = peek();
            if (c == ',') { i++; continue; }
            if (c == '}') { i++; return m; }
            throw new ParseException("expected , or } at " + i);
        }
    }

    private List<Object> array() {
        List<Object> a = new ArrayList<Object>();
        i++; // [
        ws();
        if (peek() == ']') { i++; return a; }
        while (true) {
            ws();
            a.add(value());
            ws();
            char c = peek();
            if (c == ',') { i++; continue; }
            if (c == ']') { i++; return a; }
            throw new ParseException("expected , or ] at " + i);
        }
    }

    private String string() {
        if (peek() != '"') throw new ParseException("expected string at " + i);
        i++;
        StringBuilder sb = new StringBuilder();
        while (true) {
            if (i >= s.length()) throw new ParseException("unterminated string");
            char c = s.charAt(i++);
            if (c == '"') return sb.toString();
            if (c != '\\') { sb.append(c); continue; }
            if (i >= s.length()) throw new ParseException("bad escape");
            char e = s.charAt(i++);
            switch (e) {
                case '"': sb.append('"'); break;
                case '\\': sb.append('\\'); break;
                case '/': sb.append('/'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'n': sb.append('\n'); break;
                case 'r': sb.append('\r'); break;
                case 't': sb.append('\t'); break;
                case 'u':
                    if (i + 4 > s.length()) throw new ParseException("bad \\u");
                    sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    i += 4;
                    break;
                default: throw new ParseException("bad escape \\" + e);
            }
        }
    }

    private Object number() {
        int start = i;
        if (i < s.length() && (s.charAt(i) == '-' || s.charAt(i) == '+')) i++;
        boolean frac = false;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c >= '0' && c <= '9') { i++; continue; }
            if (c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') {
                if (c == '.' || c == 'e' || c == 'E') frac = true;
                i++;
                continue;
            }
            break;
        }
        String raw = s.substring(start, i);
        if (raw.isEmpty()) throw new ParseException("bad number at " + start);
        try {
            if (!frac) {
                long l = Long.parseLong(raw);
                return Long.valueOf(l);
            }
            return Double.valueOf(Double.parseDouble(raw));
        } catch (NumberFormatException ex) {
            try {
                return Double.valueOf(Double.parseDouble(raw));
            } catch (NumberFormatException ex2) {
                throw new ParseException("bad number: " + raw);
            }
        }
    }

    /* ---------------- 输出 ---------------- */

    public static String stringify(Object o) {
        StringBuilder sb = new StringBuilder(256);
        write(sb, o);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    public static void write(StringBuilder sb, Object o) {
        if (o == null) { sb.append("null"); return; }
        if (o instanceof String) { quote(sb, (String) o); return; }
        if (o instanceof Boolean) { sb.append(((Boolean) o).booleanValue() ? "true" : "false"); return; }
        if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) { sb.append("null"); return; }
            if (d == Math.rint(d) && Math.abs(d) < 1e15) { sb.append((long) d); return; }
            sb.append(Double.toString(d));
            return;
        }
        if (o instanceof Number) { sb.append(o.toString()); return; }
        if (o instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) o).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                quote(sb, e.getKey());
                sb.append(':');
                write(sb, e.getValue());
            }
            sb.append('}');
            return;
        }
        if (o instanceof List) {
            sb.append('[');
            boolean first = true;
            for (Object x : (List<Object>) o) {
                if (!first) sb.append(',');
                first = false;
                write(sb, x);
            }
            sb.append(']');
            return;
        }
        quote(sb, String.valueOf(o));
    }

    private static void quote(StringBuilder sb, String v) {
        sb.append('"');
        for (int k = 0; k < v.length(); k++) {
            char c = v.charAt(k);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }

    /* ---------------- 取值助手 ---------------- */

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : null;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> list(Object o) {
        return o instanceof List ? (List<Object>) o : null;
    }

    public static String str(Object o) {
        return o instanceof String ? (String) o : null;
    }

    public static long lng(Object o, long dflt) {
        if (o instanceof Number) {
            double d = ((Number) o).doubleValue();
            if (!Double.isNaN(d) && !Double.isInfinite(d)) return Math.round(d);
        }
        if (o instanceof String) {
            try { return Math.round(Double.parseDouble((String) o)); } catch (Exception e) { /* noop */ }
        }
        return dflt;
    }

    public static double dbl(Object o, double dflt) {
        if (o instanceof Number) {
            double d = ((Number) o).doubleValue();
            if (!Double.isNaN(d) && !Double.isInfinite(d)) return d;
        }
        if (o instanceof String) {
            try { return Double.parseDouble((String) o); } catch (Exception e) { /* noop */ }
        }
        return dflt;
    }

    public static Object get(Map<String, Object> m, String k) {
        return m == null ? null : m.get(k);
    }
}
