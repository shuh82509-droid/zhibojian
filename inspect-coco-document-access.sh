#!/usr/bin/env sh
set -eu
PORT='24500'
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT HUP INT TERM
cat > "$TMP" <<'EOF'
王鸥美肤直播间日报|https://jqx28l0j4lx.feishu.cn/wiki/K2s2wUVC5i1ZYjku6UucFxxjnVg
品牌精选直播间日报|https://jqx28l0j4lx.feishu.cn/wiki/VNZOwok0biAQItkYVkDcQAggnDe
优选直播间日报|https://jqx28l0j4lx.feishu.cn/wiki/BmU6wQf28iVrhPk8ZEzcFeqTnQh
教练日报|https://jqx28l0j4lx.feishu.cn/wiki/M3Plw8NUPic7lakKEOGc43uvnHc
素材文档 01|https://jqx28l0j4lx.feishu.cn/docx/PKDkde7aAoYMlrx9yMMcwqOunSd
素材文档 02|https://jqx28l0j4lx.feishu.cn/docx/Q7pUdajw5oant3xglC3cvi0Ln9f
素材文档 03|https://jqx28l0j4lx.feishu.cn/docx/QSF0ducRCopJW4xvmuacqRcqnHc
素材文档 04|https://jqx28l0j4lx.feishu.cn/docx/U9jLd3DHZoszupxb8DbcPrYfnwb
素材文档 05|https://jqx28l0j4lx.feishu.cn/wiki/ALsQwaieWiClLxkTyOTcVUUNncN
素材文档 06|https://jqx28l0j4lx.feishu.cn/wiki/AutWwFvomi6e0Wk4K4Bcsa8Fnab
素材文档 07|https://jqx28l0j4lx.feishu.cn/wiki/CAKBwMjIXirLmTk3pS6cLJH7nhf
素材文档 08|https://jqx28l0j4lx.feishu.cn/wiki/DGnfwK27hi8xoDkRApDcyH2Znzc
素材文档 09|https://jqx28l0j4lx.feishu.cn/wiki/EDjBwAMrWicliKkCviDcVdwinOo
素材文档 10|https://jqx28l0j4lx.feishu.cn/wiki/F6Powz6rNiL8pnkVJmucoMrwnGb
素材文档 11|https://jqx28l0j4lx.feishu.cn/wiki/H21mweZ0SiGI8jkT5jKcygYzn6f
素材文档 12|https://jqx28l0j4lx.feishu.cn/wiki/Ia3JwQgkmiSO9DkFyeocI5K1nnd
素材文档 13|https://jqx28l0j4lx.feishu.cn/wiki/IhdwwBxFjiz0GFkNYiQctvh1nkc
素材文档 14|https://jqx28l0j4lx.feishu.cn/wiki/Ive2wnQy8isYyokHxuAcN7A5nRb
素材文档 15|https://jqx28l0j4lx.feishu.cn/wiki/Ixp3wYhguiid1wksVy0cPJzjnZg
素材文档 16|https://jqx28l0j4lx.feishu.cn/wiki/J0hewCx8Pi3kSAkqtUmcPcA2nOg
素材文档 17|https://jqx28l0j4lx.feishu.cn/wiki/Jejow2SyBiEeHXkm2WGcGTXwnkc
素材文档 18|https://jqx28l0j4lx.feishu.cn/wiki/JuCqw0plriEUEik8yeeciGu7nBe
素材文档 19|https://jqx28l0j4lx.feishu.cn/wiki/MsaVwO8vSig4ewkqPALcBINgncd
素材文档 20|https://jqx28l0j4lx.feishu.cn/wiki/NJDXwHVmbiQf4Kk6lNLcVO7FnWK
素材文档 21|https://jqx28l0j4lx.feishu.cn/wiki/OHXDwC9lniF4ckk8tiQcJowhnFd
素材文档 22|https://jqx28l0j4lx.feishu.cn/wiki/OITIwRkGziByCbkoIy3cmFmYnQf
素材文档 23|https://jqx28l0j4lx.feishu.cn/wiki/P0rcwonQNi9lDlkKfJScZdmhnSO
素材文档 24|https://jqx28l0j4lx.feishu.cn/wiki/P2PbwM5SLixMPNkJqfucsIWunKf
素材文档 25|https://jqx28l0j4lx.feishu.cn/wiki/PGl3w0y35iNhwcklyqwciL2DnMg
素材文档 26|https://jqx28l0j4lx.feishu.cn/wiki/PiU5wQbJMiOrZpkrWrCcfccwnoe
素材文档 27|https://jqx28l0j4lx.feishu.cn/wiki/Qz6mwkFjoialx7kNYXAcYGnDnSJ
素材文档 28|https://jqx28l0j4lx.feishu.cn/wiki/RByMwu1feiuC33kbiSqc0rbmnlf
素材文档 29|https://jqx28l0j4lx.feishu.cn/wiki/SRklwIYRVimFKjkfSQKcfZJknuf
素材文档 30|https://jqx28l0j4lx.feishu.cn/wiki/T5VLwALz1iLgSUk2UhXce19RnKd
素材文档 31|https://jqx28l0j4lx.feishu.cn/wiki/UNLZwRlbQimNzOkHktecMNvunyd
素材文档 32|https://jqx28l0j4lx.feishu.cn/wiki/VJQvwZiVgi8KXskbyfycIEg4nfg
素材文档 33|https://jqx28l0j4lx.feishu.cn/wiki/W7g8wUbFEifrC0k0qw8c3AY0nye
素材文档 34|https://jqx28l0j4lx.feishu.cn/wiki/XoX3wTpeQiTV8jkCncnciWzunwM
素材文档 35|https://jqx28l0j4lx.feishu.cn/wiki/Yo3rwPyCxiqdR6kARjtcphHYn4c
素材文档 36|https://jqx28l0j4lx.feishu.cn/wiki/ZbKKw3IQyiptGHk9rHickXsPnoe
素材文档 37|https://jqx28l0j4lx.feishu.cn/wiki/ZNmIwQbZpi1WJzk9HnGcM8san6g
EOF
echo '=== Coco document access report ==='
while IFS='|' read -r label url; do
  BODY=$(mktemp)
  status=$(curl -sS --max-time 30 -G --data-urlencode "url=$url" -o "$BODY" -w '%{http_code}' "http://127.0.0.1:${PORT}/api/feishu/view" || true)
  if [ "$status" = '200' ]; then
    title=$(sed -n 's#.*<h1>\(.*\)</h1>.*#\1#p' "$BODY" | head -n 1 | sed 's/&amp;/\&/g;s/&lt;/</g;s/&gt;/>/g;s/&quot;/"/g')
    printf 'READABLE | %s | %s | %s\n' "$label" "${title:-标题未返回}" "$url"
  else
    reason=$(tr '\n' ' ' < "$BODY" | sed 's/<[^>]*>/ /g' | cut -c1-240)
    printf 'DENIED   | %s | HTTP %s | %s | %s\n' "$label" "$status" "$reason" "$url"
  fi
  rm -f "$BODY"
done < "$TMP"
