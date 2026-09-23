"use client";
import { useState } from "react";
export type TrendPoint = { date: string; gmv: number | null; roi: number | null; conversion: number | null };
type Metric = "gmv" | "roi" | "conversion";
const metrics: Metric[] = ["gmv","roi","conversion"];
const labels = {gmv:"GMV（元）",roi:"ROI（倍）",conversion:"转化率（%）"};
const colors = {gmv:"#b66b24",roi:"#a94264",conversion:"#6956a5"};
const known = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const display = (key: Metric,value: number | null) => !known(value) ? "待接入" : key==="gmv" ? "¥"+value.toLocaleString("zh-CN",{maximumFractionDigits:2}) : value.toFixed(key==="conversion"?3:2)+(key==="conversion"?"%":" 倍");
/** Each metric has its own labeled numeric axis. Missing points split line segments. */
export default function MetricTrendChart({points,label}:{points:TrendPoint[];label:string}) {
  const [visible,setVisible]=useState<Record<Metric,boolean>>({gmv:true,roi:true,conversion:true});
  const [active,setActive]=useState<number|null>(null),[pinned,setPinned]=useState(false);
  const width=Math.max(860,points.length*86+200), height=410,chartBottom=310,left=86,right=154,top=38,bottom=55,plotH=chartBottom-top-bottom;
  const x=(i:number)=>left+(i+.5)*(width-left-right)/Math.max(1,points.length);
  const maximum=Object.fromEntries(metrics.map(key=>[key,Math.max(1,...points.map(p=>known(p[key])?Math.max(0,p[key] as number):0))*1.18])) as Record<Metric,number>;
  const y=(key:Metric,value:number)=>top+plotH*(1-value/maximum[key]);
  const path=(key:Metric)=>{let d="",connected=false;points.forEach((p,i)=>{if(!known(p[key])){connected=false;return}d+=(connected?" L":" M")+x(i)+" "+y(key,p[key] as number);connected=true});return d};
  const select=(i:number, pin=false)=>{if(pin){setActive(i);setPinned(true)}else if(!pinned)setActive(i)};
  return <div className="metric-trend" onKeyDown={e=>{if(e.key==="Escape"){setPinned(false);setActive(null)}}}>
    <div className="metric-trend-controls" aria-label="显示指标">{metrics.map(key=><label key={key} style={{color:colors[key]}}><input type="checkbox" checked={visible[key]} onChange={e=>setVisible({...visible,[key]:e.target.checked})}/>{labels[key]}</label>)}<small>悬停查看，点击日期锁定详情，Esc 解除</small></div>
    <div className="metric-trend-detail" role="status">{active!==null&&points[active]?<><b>{points[active].date}</b>{metrics.map(key=><span key={key}>{labels[key]} <strong>{display(key,points[active][key])}</strong></span>)}{pinned&&<button type="button" onClick={()=>setPinned(false)}>解除锁定</button>}</>:<span>选择一个日期查看完整数值；缺失指标不按 0 绘制。</span>}</div>
    {!points.length?<p>此范围暂无可核验数据。</p>:<div className="metric-trend-scroll" tabIndex={0} aria-label={label+"，可横向滚动"}><svg width={width} height={height} role="img" aria-label={label}>
      {[0,.25,.5,.75,1].map(f=><g key={f}><line x1={left} x2={width-right} y1={top+plotH*(1-f)} y2={top+plotH*(1-f)} stroke="#dfe6e1"/>{metrics.filter(key=>visible[key]).map(key=><text key={key} x={key==="gmv"?left-8:key==="roi"?width-right+12:width-64} y={top+plotH*(1-f)+4} fill={colors[key]} textAnchor={key==="gmv"?"end":"start"} fontSize="12">{(maximum[key]*f).toLocaleString("zh-CN",{maximumFractionDigits:key==="gmv"?0:key==="conversion"?3:2})}</text>)}</g>)}
      {metrics.filter(key=>visible[key]).map(key=><text key={key} x={key==="gmv"?left-8:key==="roi"?width-right+12:width-70} y={18} textAnchor={key==="gmv"?"end":"start"} fill={colors[key]} fontSize="12">{labels[key]}</text>)}
      {visible.gmv&&points.map((p,i)=>known(p.gmv)?<g key={p.date+i}><rect x={x(i)-17} y={y("gmv",p.gmv)} width={34} height={Math.max(0,top+plotH-y("gmv",p.gmv))} rx={3} fill={colors.gmv} opacity=".8"/><text x={x(i)} y={y("gmv",p.gmv)-8} textAnchor="middle" fill="#573e25" fontSize="12">{p.gmv.toLocaleString("zh-CN",{maximumFractionDigits:0})}</text></g>:null)}
      {(["roi","conversion"] as Metric[]).filter(key=>visible[key]).map(key=><g key={key}><path d={path(key)} fill="none" stroke={colors[key]} strokeWidth="2.5"/>{points.map((p,i)=>known(p[key])?<g key={p.date+i}><circle cx={x(i)} cy={y(key,p[key] as number)} r="4" fill={colors[key]}/></g>:null)}</g>)}
      {points.map((p,i)=><g key={p.date+i} tabIndex={0} role="button" aria-label={p.date+" "+metrics.map(k=>labels[k]+display(k,p[k])).join("，")} onMouseEnter={()=>select(i)} onFocus={()=>select(i)} onClick={()=>select(i,true)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select(i,true)}}}><rect x={x(i)-36} y={top} width={72} height={plotH+40} fill={active===i?"#176b5010":"transparent"} stroke={active===i?"#487c65":"none"}/><text x={x(i)} y={chartBottom-28} textAnchor="middle" fill="#45554c" fontSize="12">{p.date.length>10?p.date.slice(5,16).replace("T"," "):p.date.length>5?p.date.slice(5):p.date}</text></g>)}
      {metrics.filter(key=>visible[key]).map((key,row)=><g key={key} aria-label={labels[key]+"逐点数值"}>
        <text x={left-8} y={330+row*25} textAnchor="end" fill={colors[key]} fontSize="12">{labels[key]}</text>
        {points.map((p,i)=><text key={p.date+i} x={x(i)} y={330+row*25} textAnchor="middle" fill={colors[key]} fontSize="12">{display(key,p[key])}</text>)}
      </g>)}
      <text x={width-right} y={height-4} textAnchor="end" fill="#5c6e63" fontSize="12">日期 / 时间</text>
    </svg></div>}
  </div>;
}
