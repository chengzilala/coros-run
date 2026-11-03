"""构建「中国省市区中心点」离线数据 —— web/data/cn_regions.json

用途：地点分布（地图维度）按坐标做**最近邻匹配**，自动得出「市 + 区」，
      坐标全程不出本机（离线查表，不调用任何在线地图服务）。

数据源：阿里云 DataV.GeoAtlas（https://geo.datav.aliyun.com），公开行政区划数据，
        坐标系为 **GCJ-02**（火星坐标）。前端匹配时会把高驰坐标（WGS-84）先转成 GCJ-02。

一次性构建（需要联网）；产物是**公开行政区划数据**、非个人数据，可入库。
运行：python3 tools/build_regions.py
"""
import concurrent.futures
import json
import urllib.request

BASE = "https://geo.datav.aliyun.com/areas_v3/bound/{0}_full.json"
OUT = "web/data/cn_regions.json"


def fetch(adcode):
    req = urllib.request.Request(BASE.format(adcode), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def features(adcode):
    return fetch(adcode).get("features") or []


def main():
    provinces = features(100000)
    cities = []   # (省名, 市名, 市adcode, 市中心, 下级数量)
    direct = []   # (省名, 区县名, 中心) —— 直辖市（省的下级直接是区县）
    for p in provinces:
        pp = p["properties"]
        if pp.get("level") != "province" or not pp.get("childrenNum"):
            continue
        pname = pp["name"]
        try:
            kids = features(pp["adcode"])
        except Exception as e:  # 台湾/港澳等可能没有下级数据
            print("skip province", pname, e)
            continue
        if not kids:
            continue
        if kids[0]["properties"].get("level") == "district":   # 直辖市
            for k in kids:
                kp = k["properties"]
                if kp.get("center"):
                    direct.append((pname, kp["name"], kp["center"]))
        else:                                                  # 普通省 → 市
            for k in kids:
                kp = k["properties"]
                cities.append((pname, kp["name"], kp["adcode"], kp.get("center"), kp.get("childrenNum", 0)))

    def fetch_city(t):
        pname, cname, cad, ccenter, cn = t
        rows = []
        if not cn:  # 省直辖县级市等：自己就是最下一级
            if ccenter:
                rows.append([cname, "", ccenter])
            return rows
        try:
            kids = features(cad)
        except Exception:
            if ccenter:
                rows.append([cname, "", ccenter])
            return rows
        for k in kids:
            kp = k["properties"]
            if kp.get("center"):
                rows.append([cname, kp["name"], kp["center"]])
        return rows

    all_rows = [[pname, dname, center] for pname, dname, center in direct]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for rows in ex.map(fetch_city, cities):
            all_rows.extend(rows)

    data = []
    for cname, dname, center in all_rows:
        label = (cname + " " + dname).strip()
        data.append([round(float(center[0]), 5), round(float(center[1]), 5), label])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "src": "DataV.GeoAtlas GCJ-02", "d": data}, f,
                  ensure_ascii=False, separators=(",", ":"))
    print("城市/区县中心点:", len(data), "→", OUT)


if __name__ == "__main__":
    main()
