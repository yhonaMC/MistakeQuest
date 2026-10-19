import {WebGLRenderer,Scene,PerspectiveCamera,CubeTexture,PMREMGenerator,HemisphereLight,DirectionalLight,PointLight,MeshPhysicalMaterial,MeshStandardMaterial,Group,Mesh,TorusGeometry,CapsuleGeometry,SphereGeometry,BufferGeometry,BufferAttribute,PointsMaterial,Points,CatmullRomCurve3,Vector3,TubeGeometry,ACESFilmicToneMapping} from 'three';

export function mountOrbit(container,options,onReady,onFallback){
  const renderer=new WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor(0x000000,0);renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;renderer.domElement.setAttribute('aria-hidden','true');container.append(renderer.domElement);
  const scene=new Scene(),camera=new PerspectiveCamera(34,1,.1,30);camera.position.set(0,0,8.8);
  const faces=[];
  for(let i=0;i<6;i++){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,128,128);
    gradient.addColorStop(0,['#e9f3ff','#aaa0cd','#ffffff','#12121b','#beb9da','#50556c'][i]);gradient.addColorStop(.45,['#414252','#202129','#c5c7d3','#181a21','#686b7a','#1e1e27'][i]);gradient.addColorStop(1,'#11121a');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
    if(i!==3){ctx.fillStyle='#fff';ctx.fillRect(15,8,18,88);ctx.fillStyle='#d6dcff';ctx.fillRect(95,15,11,73);}faces.push(canvas);
  }
  const cube=new CubeTexture(faces);cube.needsUpdate=true;const pmrem=new PMREMGenerator(renderer),environment=pmrem.fromCubemap(cube);scene.environment=environment.texture;pmrem.dispose();cube.dispose();
  scene.add(new HemisphereLight(0xffffff,0x292339,2.2));const key=new DirectionalLight(0xffffff,4);key.position.set(-3,4,5);scene.add(key);const edge=new PointLight(0xe1dbff,35,15);edge.position.set(3,1,-1);scene.add(edge);const front=new PointLight(0xffffff,12,20);front.position.set(-3,-2,4);scene.add(front);
  const purple=new MeshPhysicalMaterial({color:'#b5a0ff',metalness:.44,roughness:.19,clearcoat:1,clearcoatRoughness:.16,envMapIntensity:1.5}),mint=new MeshPhysicalMaterial({color:'#a1efd2',metalness:.28,roughness:.22,clearcoat:1}),ringMaterial=new MeshStandardMaterial({color:'#b5a0ff',metalness:.7,roughness:.25,transparent:true,opacity:.5});
  const sculpture=new Group(),emblem=new Group();scene.add(sculpture);sculpture.add(emblem);
  emblem.add(new Mesh(new TorusGeometry(1.05,.315,28,88),purple));const tail=new Mesh(new CapsuleGeometry(.19,.62,10,24),purple);tail.rotation.z=-.78;tail.position.set(.87,-.91,.16);emblem.add(tail);const bead=new Mesh(new SphereGeometry(.25,28,20),mint);bead.position.set(.2,.07,.4);emblem.add(bead);
  const orbitRadius=1.92,orbit=new Mesh(new TorusGeometry(orbitRadius,.012,6,120),ringMaterial);orbit.rotation.set(.97,.2,-.35);sculpture.add(orbit);const orbit2=new Mesh(new TorusGeometry(1.69,.009,6,100),ringMaterial);orbit2.rotation.set(-.8,-.55,.3);sculpture.add(orbit2);const satellite=new Mesh(new SphereGeometry(.105,18,12),mint);orbit.add(satellite);
  const coords=new Float32Array(92*3);for(let i=0;i<92;i++){const a=i*2.39996,r=1.65+(i%13)/13*1.1;coords[i*3]=Math.cos(a)*r;coords[i*3+1]=Math.sin(a)*r*.8;coords[i*3+2]=Math.sin(i*7)*.8;}
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(coords,3));const particlesMaterial=new PointsMaterial({color:'#b5a0ff',size:.025,transparent:true,opacity:.42,depthWrite:false}),particles=new Points(geometry,particlesMaterial);scene.add(particles);
  const check=new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(-.57,.05,.6),new Vector3(-.17,-.34,.6),new Vector3(.66,.5,.6)]),20,.1,12,false),mint);scene.add(check);
  let raf=0,previous=performance.now(),elapsed=0,visible=false,disposed=false,lost=false,frames=0,pulse=0,lastEvent=options().eventId,ready=false;
  const pointer={x:0,y:0},rotation={x:0,y:0},targetScale=new Vector3();
  function active(){return !disposed&&!lost&&visible&&!document.hidden;}
  function draw(time=performance.now()){
    if(disposed||lost)return;const {motion,state}=options(),dt=Math.min((time-previous)/1000,.06)||.033;previous=time;if(motion)elapsed+=dt;
    const wave=motion?Math.sin(elapsed*.8):.3,success=state==='success',scanning=state==='scanning';
    rotation.x+=(pointer.y*.24-rotation.x)*.07;rotation.y+=(pointer.x*.42-rotation.y)*.07;sculpture.rotation.set(.12+rotation.x,-.33+rotation.y,-.27+wave*.025);sculpture.position.y=wave*.075;
    const scale=(success?.76:1)+pulse*.08;targetScale.setScalar(scale);sculpture.scale.lerp(targetScale,motion?.13:1);emblem.rotation.y=scanning?Math.sin(elapsed*2.3)*.38:Math.sin(elapsed*.3)*.09;
    if(motion){orbit.rotation.z+=dt*(scanning?1.5:.06);orbit2.rotation.y+=dt*(scanning?1.2:.045);pulse=Math.max(0,pulse-dt*.9);}
    satellite.position.set(Math.cos(elapsed*.55)*orbitRadius,Math.sin(elapsed*.55)*orbitRadius,0);particles.rotation.z=elapsed*.018;particles.rotation.y=elapsed*.015;particlesMaterial.opacity=scanning?.8:.42;
    check.visible=success;if(success){check.position.set(.72,-.85,1.4);check.rotation.z=-.08+wave*.02;check.scale.setScalar(.7+pulse*.06);}renderer.render(scene,camera);container.dataset.frames=String(++frames);if(!ready){ready=true;onReady();}
  }
  function loop(time){raf=0;if(!active()||!options().motion)return;if(time-previous>=31)draw(time);raf=requestAnimationFrame(loop);}
  function wake(){if(!active())return;draw();if(options().motion&&!raf)raf=requestAnimationFrame(loop);}
  function halt(){cancelAnimationFrame(raf);raf=0;}
  function resize(){const {width,height}=container.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();wake();}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)resize();else halt();},{rootMargin:'80px'});intersection.observe(container);
  const move=event=>{if(!options().motion)return;const r=container.getBoundingClientRect();pointer.x=(event.clientX-r.left)/r.width*2-1;pointer.y=(event.clientY-r.top)/r.height*2-1;},leave=()=>{pointer.x=pointer.y=0;},click=()=>{if(options().motion){pulse=2.7;wake();}},visibility=()=>document.hidden?halt():wake(),contextLost=event=>{event.preventDefault();lost=true;halt();onFallback();};
  container.addEventListener('pointermove',move);container.addEventListener('pointerleave',leave);container.addEventListener('click',click);document.addEventListener('visibilitychange',visibility);renderer.domElement.addEventListener('webglcontextlost',contextLost);
  return {
    update(){const next=options();if(next.eventId!==lastEvent){lastEvent=next.eventId;if(next.state==='success')pulse=1.8;}if(!next.motion)halt();wake();},
    dispose(){disposed=true;halt();resizeObserver.disconnect();intersection.disconnect();container.removeEventListener('pointermove',move);container.removeEventListener('pointerleave',leave);container.removeEventListener('click',click);document.removeEventListener('visibilitychange',visibility);renderer.domElement.removeEventListener('webglcontextlost',contextLost);const geometries=new Set(),materials=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose());environment.dispose();renderer.dispose();renderer.domElement.remove();}
  };
}
