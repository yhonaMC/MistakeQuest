export async function api(path,{method='GET',body,signal}={}){
  const response=await fetch('/api'+path,{method,signal,headers:{'x-mistakequest':'1',...body!==undefined?{'Content-Type':'application/json'}:{}},...body!==undefined?{body:JSON.stringify(body)}:{}});
  const result=await response.json();if(!response.ok){const error=new Error(result.error?.message||'No se pudo conectar con el servicio local.');error.code=result.error?.code;throw error;}return result;
}
