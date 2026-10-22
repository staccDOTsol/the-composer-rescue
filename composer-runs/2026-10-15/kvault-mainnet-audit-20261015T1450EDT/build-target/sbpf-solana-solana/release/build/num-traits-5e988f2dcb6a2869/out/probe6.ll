; ModuleID = 'probe6.23a5e2aee68ee9b6-cgu.0'
source_filename = "probe6.23a5e2aee68ee9b6-cgu.0"
target datalayout = "e-m:e-p:64:64-i64:64-n32:64-S128"
target triple = "sbf"

; core::f64::<impl f64>::is_subnormal
; Function Attrs: inlinehint nounwind
define internal zeroext i1 @"_ZN4core3f6421_$LT$impl$u20$f64$GT$12is_subnormal17hafdf07207545b7c3E"(double %self) unnamed_addr #0 {
start:
  %_2 = alloca [1 x i8], align 1
  %b = bitcast double %self to i64
  %_5 = and i64 %b, 4503599627370495
  %_6 = and i64 %b, 9218868437227405312
  %0 = icmp eq i64 %_5, 0
  br i1 %0, label %bb3, label %bb2

bb3:                                              ; preds = %start
  %1 = icmp eq i64 %_6, 9218868437227405312
  br i1 %1, label %bb9, label %bb2

bb2:                                              ; preds = %bb3, %start
  switch i64 %_6, label %bb4 [
    i64 9218868437227405312, label %bb8
    i64 0, label %bb5
  ]

bb9:                                              ; preds = %bb3
  store i8 1, ptr %_2, align 1
  br label %bb1

bb1:                                              ; preds = %bb4, %bb6, %bb7, %bb8, %bb9
  %2 = load i8, ptr %_2, align 1
  %_3 = zext i8 %2 to i64
  %_0 = icmp eq i64 %_3, 3
  ret i1 %_0

bb4:                                              ; preds = %bb2
  store i8 4, ptr %_2, align 1
  br label %bb1

bb8:                                              ; preds = %bb2
  store i8 0, ptr %_2, align 1
  br label %bb1

bb5:                                              ; preds = %bb2
  %3 = icmp eq i64 %_5, 0
  br i1 %3, label %bb7, label %bb6

bb7:                                              ; preds = %bb5
  store i8 2, ptr %_2, align 1
  br label %bb1

bb6:                                              ; preds = %bb5
  store i8 3, ptr %_2, align 1
  br label %bb1
}

; probe6::probe
; Function Attrs: nounwind
define hidden void @_ZN6probe65probe17hfee77f50ba9a092eE() unnamed_addr #1 {
start:
; call core::f64::<impl f64>::is_subnormal
  %_1 = call zeroext i1 @"_ZN4core3f6421_$LT$impl$u20$f64$GT$12is_subnormal17hafdf07207545b7c3E"(double 1.000000e+00) #2
  ret void
}

attributes #0 = { inlinehint nounwind "target-cpu"="generic" "target-features"="+store-imm,+jmp-ext" }
attributes #1 = { nounwind "target-cpu"="generic" "target-features"="+store-imm,+jmp-ext" }
attributes #2 = { nounwind }

!llvm.module.flags = !{!0}
!llvm.ident = !{!1}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{!"rustc version 1.89.0-dev"}
