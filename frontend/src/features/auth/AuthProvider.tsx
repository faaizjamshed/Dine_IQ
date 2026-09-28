import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { postLogin, postRegister, fetchMe, postLogout } from '@/api/endpoints'
import { roleHasPermission, type Permission } from '@/lib/permissions'
import type { User } from '@/api/types'
type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated'
interface AuthContextValue {user:User|null;status:AuthStatus;useMocks:boolean;login:(email:string,password:string)=>Promise<void>;register:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;hasPermission:(p:Permission)=>boolean;roleLabel:undefined}
const AuthContext=React.createContext<AuthContextValue|null>(null)
export function AuthProvider({children}:{children:React.ReactNode}) {
 const queryClient=useQueryClient()
 const [user,setUser]=React.useState<User|null>(null)
 const [status,setStatus]=React.useState<AuthStatus>('restoring')
 const authRevision=React.useRef(0)
 React.useEffect(()=>{
  let cancelled=false
    const revision=authRevision.current
    fetchMe().then(r=>{if(!cancelled&&authRevision.current===revision){setUser(r.user);setStatus(r.user?'authenticated':'unauthenticated')}})
     .catch(()=>{if(!cancelled&&authRevision.current===revision)setStatus('unauthenticated')})
  const expired=()=>{setUser(null);setStatus('unauthenticated');queryClient.clear()}
  window.addEventListener('dineiq:session-expired',expired)
  return ()=>{cancelled=true;window.removeEventListener('dineiq:session-expired',expired)}
 },[queryClient])
 const login=React.useCallback(async(email:string,password:string)=>{
    authRevision.current+=1
  try{const r=await postLogin({email,password});queryClient.clear();setUser(r.user);setStatus('authenticated')}
    catch(e){setStatus('unauthenticated');throw new Error(e instanceof ApiError&&e.kind==='auth'?'invalid_credentials':'network')}
 },[queryClient])
 const register=React.useCallback(async(email:string,password:string)=>{
    authRevision.current+=1
    try{const r=await postRegister({email,password});queryClient.clear();setUser(r.user);setStatus('authenticated')}
    catch(e){setStatus('unauthenticated');throw e}
 },[queryClient])
 const logout=React.useCallback(async()=>{
    authRevision.current+=1
  try{await postLogout()}catch(e){if(!(e instanceof ApiError&&e.kind==='auth')){window.alert('Sign-out failed. Check the backend connection and retry.');return}}
  setUser(null);setStatus('unauthenticated');queryClient.clear()
 },[queryClient])
 const hasPermission=React.useCallback((p:Permission)=>p!=='recommendations.manage'&&roleHasPermission(user?.role,p),[user])
 return <AuthContext.Provider value={{user,status,useMocks:false,login,register,logout,hasPermission,roleLabel:undefined}}>{children}</AuthContext.Provider>
}
export function useAuth(){const ctx=React.useContext(AuthContext);if(!ctx)throw new Error('AuthProvider required');return ctx}
