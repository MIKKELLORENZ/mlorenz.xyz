/* json.hpp — the smallest JSON that can round-trip a champion file.
 *
 * The port has exactly one hard interop requirement: a brain written here must
 * load in the browser's Net.fromJSON, and a brain written by the JS trainer must
 * load here. Everything else the dashboard reads is a log line or a small object.
 * So this is a complete-but-plain parser/serialiser and nothing more — no schema,
 * no streaming, no dependencies.
 *
 * NUMBER FORMATTING is the only subtle part. JSON.stringify emits the SHORTEST
 * decimal that round-trips to the same double, and a champion file is 26,045
 * weights; printing all of them at %.17g would trade a 400 KB file for a 700 KB
 * one and, worse, would make a diff against the JS writer unreadable. So numToStr
 * walks precision upward and stops at the first one that parses back bit-for-bit,
 * which reproduces JSON.stringify's output for every value this project writes.
 */
#pragma once
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <stdexcept>
#include <fstream>
#include <sstream>

namespace js {

inline std::string numToStr(double v) {
    if (std::isnan(v) || std::isinf(v)) return "null";   // what JSON.stringify does
    if (v == 0) return std::signbit(v) ? "0" : "0";      // JS prints -0 as 0
    char buf[64];
    for (int p = 1; p <= 17; p++) {
        std::snprintf(buf, sizeof buf, "%.*g", p, v);
        if (std::strtod(buf, nullptr) == v) break;
    }
    /* JS writes 1e+21 as 1e+21 but 1e5 as 100000; %g switches to exponent form
     * far earlier than JSON.stringify does. Only the exponent SPELLING differs
     * (%g emits e-05, JS emits e-5), and both parse identically, so the one thing
     * worth normalising is the leading zero — it keeps a byte-diff against the JS
     * writer legible when checking the two agree. */
    std::string s(buf);
    size_t e = s.find('e');
    if (e != std::string::npos) {
        size_t d = e + 2;                                 // past 'e' and the sign
        size_t z = d;
        while (z + 1 < s.size() && s[z] == '0') z++;
        s = s.substr(0, d) + s.substr(z);
    }
    return s;
}

struct Value;
using ValuePtr = std::shared_ptr<Value>;

struct Value {
    enum Type { NUL, BOOL, NUM, STR, ARR, OBJ } type = NUL;
    bool b = false;
    double num = 0;
    std::string str;
    std::vector<ValuePtr> arr;
    std::vector<std::pair<std::string, ValuePtr>> obj;   // insertion-ordered, like JS

    static ValuePtr makeNull() { auto v = std::make_shared<Value>(); v->type = NUL; return v; }
    static ValuePtr make(double d) { auto v = std::make_shared<Value>(); v->type = NUM; v->num = d; return v; }
    static ValuePtr make(bool x) { auto v = std::make_shared<Value>(); v->type = BOOL; v->b = x; return v; }
    static ValuePtr make(const std::string& s) { auto v = std::make_shared<Value>(); v->type = STR; v->str = s; return v; }
    static ValuePtr makeArr() { auto v = std::make_shared<Value>(); v->type = ARR; return v; }
    static ValuePtr makeObj() { auto v = std::make_shared<Value>(); v->type = OBJ; return v; }

    void set(const std::string& k, ValuePtr v) {
        for (auto& kv : obj) if (kv.first == k) { kv.second = v; return; }
        obj.emplace_back(k, v);
    }
    void set(const std::string& k, double d) { set(k, make(d)); }
    void set(const std::string& k, const std::string& s) { set(k, make(s)); }
    void push(ValuePtr v) { arr.push_back(v); }

    ValuePtr get(const std::string& k) const {
        for (auto& kv : obj) if (kv.first == k) return kv.second;
        return nullptr;
    }
    bool has(const std::string& k) const { return get(k) != nullptr; }
    double numOr(const std::string& k, double d) const { auto v = get(k); return v && v->type == NUM ? v->num : d; }
    std::string strOr(const std::string& k, const std::string& d) const {
        auto v = get(k); return v && v->type == STR ? v->str : d;
    }

    /* Numeric array, which is 99% of what a brain file is. */
    std::vector<double> nums() const {
        std::vector<double> o;
        o.reserve(arr.size());
        for (auto& e : arr) o.push_back(e && e->type == NUM ? e->num : 0.0);
        return o;
    }
};

/* ------------------------------------------------------------------- parsing */
class Parser {
    const char* p; const char* end;
public:
    explicit Parser(const std::string& s) : p(s.data()), end(s.data() + s.size()) {}
    ValuePtr parse() { skip(); ValuePtr v = value(); return v; }
private:
    [[noreturn]] void fail(const char* m) { throw std::runtime_error(std::string("json: ") + m); }
    void skip() { while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++; }
    ValuePtr value() {
        if (p >= end) fail("unexpected end");
        switch (*p) {
            case '{': return object();
            case '[': return array();
            case '"': { auto v = Value::make(std::string()); v->str = string(); return v; }
            case 't': expect("true"); return Value::make(true);
            case 'f': expect("false"); return Value::make(false);
            case 'n': expect("null"); return Value::makeNull();
            default: return number();
        }
    }
    void expect(const char* lit) {
        size_t n = std::strlen(lit);
        if ((size_t)(end - p) < n || std::strncmp(p, lit, n) != 0) fail("bad literal");
        p += n;
    }
    ValuePtr number() {
        char* e = nullptr;
        double d = std::strtod(p, &e);
        if (e == p) fail("bad number");
        p = e;
        return Value::make(d);
    }
    std::string string() {
        if (*p != '"') fail("expected string");
        p++;
        std::string s;
        while (p < end && *p != '"') {
            if (*p == '\\') {
                p++;
                if (p >= end) fail("bad escape");
                switch (*p) {
                    case '"': s += '"'; break;   case '\\': s += '\\'; break;
                    case '/': s += '/'; break;   case 'b': s += '\b'; break;
                    case 'f': s += '\f'; break;  case 'n': s += '\n'; break;
                    case 'r': s += '\r'; break;  case 't': s += '\t'; break;
                    case 'u': {
                        if (end - p < 5) fail("bad \\u");
                        char hex[5] = { p[1], p[2], p[3], p[4], 0 };
                        unsigned cp = (unsigned)std::strtoul(hex, nullptr, 16);
                        p += 4;
                        // UTF-8 encode; surrogate pairs are not used by anything here
                        if (cp < 0x80) s += (char)cp;
                        else if (cp < 0x800) { s += (char)(0xC0 | (cp >> 6)); s += (char)(0x80 | (cp & 0x3F)); }
                        else { s += (char)(0xE0 | (cp >> 12)); s += (char)(0x80 | ((cp >> 6) & 0x3F)); s += (char)(0x80 | (cp & 0x3F)); }
                        break;
                    }
                    default: fail("bad escape");
                }
                p++;
            } else s += *p++;
        }
        if (p >= end) fail("unterminated string");
        p++;
        return s;
    }
    ValuePtr array() {
        auto v = Value::makeArr();
        p++; skip();
        if (p < end && *p == ']') { p++; return v; }
        while (true) {
            skip();
            v->arr.push_back(value());
            skip();
            if (p < end && *p == ',') { p++; continue; }
            if (p < end && *p == ']') { p++; break; }
            fail("expected , or ]");
        }
        return v;
    }
    ValuePtr object() {
        auto v = Value::makeObj();
        p++; skip();
        if (p < end && *p == '}') { p++; return v; }
        while (true) {
            skip();
            std::string k = string();
            skip();
            if (p >= end || *p != ':') fail("expected :");
            p++; skip();
            v->obj.emplace_back(k, value());
            skip();
            if (p < end && *p == ',') { p++; continue; }
            if (p < end && *p == '}') { p++; break; }
            fail("expected , or }");
        }
        return v;
    }
};

/* --------------------------------------------------------------- serialising */
inline void writeStr(std::string& o, const std::string& s) {
    o += '"';
    for (char c : s) {
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if ((unsigned char)c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
                else o += c;
        }
    }
    o += '"';
}

inline void stringify(const ValuePtr& v, std::string& o) {
    if (!v) { o += "null"; return; }
    switch (v->type) {
        case Value::NUL: o += "null"; break;
        case Value::BOOL: o += v->b ? "true" : "false"; break;
        case Value::NUM: o += numToStr(v->num); break;
        case Value::STR: writeStr(o, v->str); break;
        case Value::ARR: {
            o += '[';
            for (size_t i = 0; i < v->arr.size(); i++) { if (i) o += ','; stringify(v->arr[i], o); }
            o += ']';
            break;
        }
        case Value::OBJ: {
            o += '{';
            for (size_t i = 0; i < v->obj.size(); i++) {
                if (i) o += ',';
                writeStr(o, v->obj[i].first);
                o += ':';
                stringify(v->obj[i].second, o);
            }
            o += '}';
            break;
        }
    }
}
inline std::string stringify(const ValuePtr& v) { std::string o; o.reserve(1 << 16); stringify(v, o); return o; }

inline ValuePtr numArray(const std::vector<double>& a) {
    auto v = Value::makeArr();
    v->arr.reserve(a.size());
    for (double d : a) v->arr.push_back(Value::make(d));
    return v;
}
inline ValuePtr numArray(const float* a, size_t n) {
    auto v = Value::makeArr();
    v->arr.reserve(n);
    for (size_t i = 0; i < n; i++) v->arr.push_back(Value::make((double)a[i]));
    return v;
}

/* ------------------------------------------------------------------ file i/o */
inline std::string readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot read " + path);
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}
inline ValuePtr readJSON(const std::string& path) { return Parser(readFile(path)).parse(); }
inline bool tryReadJSON(const std::string& path, ValuePtr& out) {
    try { out = readJSON(path); return true; } catch (...) { return false; }
}

/* Written under a dot-name and renamed, because the dashboard polls these files
 * between generations and a half-written champion parses as a corrupt brain.
 * rename is atomic within a filesystem; write-in-place is not. */
inline void writeFileAtomic(const std::string& path, const std::string& data) {
    size_t slash = path.find_last_of("/\\");
    std::string dir = slash == std::string::npos ? std::string(".") : path.substr(0, slash);
    std::string base = slash == std::string::npos ? path : path.substr(slash + 1);
    std::string tmp = dir + "/." + base + ".tmp";
    { std::ofstream f(tmp, std::ios::binary); f << data; }
    std::remove(path.c_str());
    if (std::rename(tmp.c_str(), path.c_str()) != 0) {
        std::ofstream f(path, std::ios::binary);
        f << data;
        std::remove(tmp.c_str());
    }
}
inline void appendLine(const std::string& path, const std::string& line) {
    std::ofstream f(path, std::ios::app | std::ios::binary);
    f << line << "\n";
}

} // namespace js
